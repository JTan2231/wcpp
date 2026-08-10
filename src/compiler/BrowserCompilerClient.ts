import type {
  BuildWorkerCommand,
  BuildWorkerEvent,
  RunWorkerCommand,
  RunWorkerEvent,
} from "./internal-protocol";
import type {
  CompileAndRunRequest,
  CompilerClient,
  CompilerEventListener,
  CompilerWorkerEvent,
} from "../protocol";

const COMPILE_TIMEOUT_MS = 45_000;
const RUN_START_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 2_000;
const OUTPUT_LIMIT_BYTES = 1_000_000;

interface ActiveRequest {
  request: CompileAndRunRequest;
  compileTimer: ReturnType<typeof setTimeout> | null;
  runTimer: ReturnType<typeof setTimeout> | null;
}

export class BrowserCompilerClient implements CompilerClient {
  private compilerWorker: Worker | null = null;
  private runnerWorker: Worker | null = null;
  private readonly listeners = new Set<CompilerEventListener>();
  private active: ActiveRequest | null = null;

  compileAndRun(request: CompileAndRunRequest): void {
    if (this.active) throw new Error("A program is already running");

    const source = request.files.find((file) => file.path === "main.cpp");
    if (!source) throw new Error("main.cpp is required");
    const compilerWorker = this.ensureCompilerWorker();

    this.active = {
      request,
      compileTimer: setTimeout(() => {
        if (
          this.active?.request.requestId !== request.requestId ||
          this.compilerWorker !== compilerWorker
        ) {
          return;
        }
        this.discardCompiler();
        this.fail(request.requestId, "compiler", "Compilation timed out after 45 seconds");
      }, COMPILE_TIMEOUT_MS),
      runTimer: null,
    };

    this.emit({
      type: "phase",
      requestId: request.requestId,
      phase: "compiling",
      message: "Loading C++ toolchain…",
    });

    if (
      this.active?.request.requestId !== request.requestId ||
      this.compilerWorker !== compilerWorker
    ) {
      return;
    }

    const command: BuildWorkerCommand = {
      type: "build",
      requestId: request.requestId,
      source: source.contents,
    };
    compilerWorker.postMessage(command);
  }

  cancel(requestId: string): void {
    if (this.active?.request.requestId !== requestId) return;

    if (this.runnerWorker) {
      this.runnerWorker.terminate();
      this.runnerWorker = null;
    } else {
      this.discardCompiler();
    }

    this.clearTimers();
    this.active = null;
    this.emit({ type: "cancelled", requestId });
  }

  subscribe(listener: CompilerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.clearTimers();
    this.discardCompiler();
    this.runnerWorker?.terminate();
    this.runnerWorker = null;
    this.active = null;
    this.listeners.clear();
  }

  private createCompilerWorker(): Worker {
    const worker = new Worker("/workers/compiler.worker.js");
    worker.addEventListener("message", (event: MessageEvent<BuildWorkerEvent>) => {
      if (this.compilerWorker !== worker) return;
      this.onBuildEvent(event.data);
    });
    worker.addEventListener("error", (event) => {
      if (this.compilerWorker !== worker) return;
      const requestId = this.active?.request.requestId;
      this.compilerWorker = null;
      worker.terminate();
      if (requestId) {
        this.fail(requestId, "compiler", event.message || "Compiler worker crashed");
      }
    });
    return worker;
  }

  private ensureCompilerWorker(): Worker {
    this.compilerWorker ??= this.createCompilerWorker();
    return this.compilerWorker;
  }

  private discardCompiler(): void {
    this.compilerWorker?.terminate();
    this.compilerWorker = null;
  }

  private onBuildEvent(event: BuildWorkerEvent): void {
    if (this.active?.request.requestId !== event.requestId) return;

    if (event.type === "phase") {
      this.emit({
        type: "phase",
        requestId: event.requestId,
        phase: "compiling",
        message: event.message,
      });
      return;
    }

    if (this.active.compileTimer) {
      clearTimeout(this.active.compileTimer);
      this.active.compileTimer = null;
    }

    if (event.diagnostics.length > 0) {
      this.emit({
        type: "diagnostics",
        requestId: event.requestId,
        diagnostics: event.diagnostics,
      });
      if (this.active?.request.requestId !== event.requestId) return;
    }

    if (event.type === "build-failed") {
      if (event.fatal) this.discardCompiler();
      this.fail(event.requestId, "compiler", event.message);
      return;
    }

    this.startRunner(event.requestId, event.wasm);
  }

  private startRunner(requestId: string, wasm: ArrayBuffer): void {
    if (!this.active || this.active.request.requestId !== requestId) return;

    this.emit({
      type: "phase",
      requestId,
      phase: "running",
      message: "Preparing program…",
    });

    if (!this.active || this.active.request.requestId !== requestId) return;

    let runner: Worker;
    try {
      runner = new Worker("/workers/runner.worker.js");
    } catch (error) {
      this.fail(
        requestId,
        "runtime",
        error instanceof Error ? error.message : "Could not start program worker",
      );
      return;
    }
    this.runnerWorker = runner;
    runner.addEventListener("message", (event: MessageEvent<RunWorkerEvent>) => {
      if (this.runnerWorker !== runner) return;
      this.onRunEvent(event.data, runner);
    });
    runner.addEventListener("error", (event) => {
      if (
        this.active?.request.requestId !== requestId ||
        this.runnerWorker !== runner
      ) {
        return;
      }
      runner.terminate();
      this.runnerWorker = null;
      this.fail(requestId, "runtime", event.message || "Program worker crashed");
    });

    this.active.runTimer = setTimeout(() => {
      if (
        this.active?.request.requestId !== requestId ||
        this.runnerWorker !== runner
      ) {
        return;
      }
      runner.terminate();
      this.runnerWorker = null;
      this.fail(requestId, "runtime", "Program startup timed out after 15 seconds");
    }, RUN_START_TIMEOUT_MS);

    const command: RunWorkerCommand = {
      type: "run",
      requestId,
      wasm,
      args: this.active.request.args ?? [],
      stdin: this.active.request.stdin ?? "",
      outputLimitBytes: OUTPUT_LIMIT_BYTES,
    };
    runner.postMessage(command, [wasm]);
  }

  private onRunEvent(event: RunWorkerEvent, runner: Worker): void {
    if (
      this.active?.request.requestId !== event.requestId ||
      this.runnerWorker !== runner
    ) {
      return;
    }

    if (event.type === "started") {
      if (this.active.runTimer) clearTimeout(this.active.runTimer);
      this.active.runTimer = setTimeout(() => {
        if (
          this.active?.request.requestId !== event.requestId ||
          this.runnerWorker !== runner
        ) {
          return;
        }
        runner.terminate();
        this.runnerWorker = null;
        this.fail(event.requestId, "runtime", "Execution timed out after 2 seconds");
      }, RUN_TIMEOUT_MS);
      this.emit({
        type: "phase",
        requestId: event.requestId,
        phase: "running",
        message: "Running…",
      });
      return;
    }

    if (event.type === "stdout" || event.type === "stderr") {
      this.emit(event);
      return;
    }

    runner.terminate();
    this.runnerWorker = null;

    if (this.active.runTimer) {
      clearTimeout(this.active.runTimer);
      this.active.runTimer = null;
    }

    if (event.type === "run-failed") {
      this.fail(event.requestId, "runtime", event.message);
      return;
    }

    const exitCode = event.exitCode;
    this.active = null;
    this.emit({
      type: "finished",
      requestId: event.requestId,
      exitCode,
    });
  }

  private fail(
    requestId: string,
    stage: "compiler" | "runtime" | "client",
    message: string,
  ): void {
    if (this.active?.request.requestId !== requestId) return;
    this.clearTimers();
    this.runnerWorker?.terminate();
    this.runnerWorker = null;
    this.active = null;
    this.emit({ type: "failed", requestId, stage, message });
  }

  private clearTimers(): void {
    if (!this.active) return;
    if (this.active.compileTimer) clearTimeout(this.active.compileTimer);
    if (this.active.runTimer) clearTimeout(this.active.runTimer);
    this.active.compileTimer = null;
    this.active.runTimer = null;
  }

  private emit(event: CompilerWorkerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
