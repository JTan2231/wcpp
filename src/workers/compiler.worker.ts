import type {
  BuildWorkerCommand,
  BuildWorkerEvent,
} from "../compiler/internal-protocol";
import type { CompilerDiagnostic } from "../protocol";

interface FileTree {
  [name: string]: string | Uint8Array | FileTree;
}

interface YoWaspClang {
  runClang(
    args?: string[],
    files?: FileTree,
    options?: {
      stdout?: (bytes: Uint8Array | null) => void;
      stderr?: (bytes: Uint8Array | null) => void;
      fetchProgress?: (event: {
        totalLength: number;
        doneLength: number;
      }) => void;
    },
  ): Promise<FileTree | undefined> | FileTree | undefined;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
const toolchainModuleUrl = "/toolchain/v1/bundle.js";

let toolchainReady: Promise<YoWaspClang> | null = null;

function loadToolchain(): Promise<YoWaspClang> {
  toolchainReady ??= import(toolchainModuleUrl).then(async (module: YoWaspClang) => {
    await module.runClang();
    return module;
  });
  return toolchainReady;
}

function send(event: BuildWorkerEvent, transfer: Transferable[] = []): void {
  worker.postMessage(event, transfer);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function parseDiagnostics(log: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const expression = /^(.+?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.+)$/;

  for (const line of stripAnsi(log).split("\n")) {
    const match = expression.exec(line.trim());
    if (!match) continue;

    const [, rawFile, lineNumber, columnNumber, rawSeverity, message] = match;
    diagnostics.push({
      severity: rawSeverity.includes("error")
        ? "error"
        : rawSeverity === "warning"
          ? "warning"
          : "note",
      message,
      file: rawFile.endsWith("main.cpp") ? "main.cpp" : rawFile,
      line: Number(lineNumber),
      column: Number(columnNumber),
    });
  }

  return diagnostics;
}

worker.onmessage = async (event: MessageEvent<BuildWorkerCommand>) => {
  if (event.data.type !== "build") return;

  const { requestId, source } = event.data;
  let compilerLog = "";
  let toolchainLoaded = false;
  const stderrDecoder = new TextDecoder();

  try {
    send({ type: "phase", requestId, message: "Loading C++20 toolchain…" });
    const { runClang } = await loadToolchain();
    toolchainLoaded = true;

    send({ type: "phase", requestId, message: "Compiling and linking main.cpp…" });
    const files = await runClang(
      [
        "clang++",
        "--target=wasm32-unknown-wasip1",
        "--sysroot=/usr",
        "-resource-dir=/usr",
        "-std=c++20",
        "-fno-exceptions",
        "-fno-color-diagnostics",
        "-O0",
        "-Wl,--max-memory=134217728",
        "-Wl,-z,stack-size=1048576",
        "main.cpp",
        "-o",
        "program.wasm",
      ],
      { "main.cpp": source },
      {
        stderr(bytes) {
          compilerLog += bytes
            ? stderrDecoder.decode(bytes, { stream: true })
            : stderrDecoder.decode();
        },
      },
    );

    const output = files?.["program.wasm"];
    if (!(output instanceof Uint8Array)) {
      throw new Error("Clang did not produce program.wasm");
    }

    const wasm = new Uint8Array(output.byteLength);
    wasm.set(output);
    const diagnostics = parseDiagnostics(compilerLog);
    send({ type: "built", requestId, wasm: wasm.buffer, diagnostics }, [wasm.buffer]);
  } catch (error) {
    const diagnostics = parseDiagnostics(compilerLog);
    const readableLog = stripAnsi(compilerLog).trim();
    send({
      type: "build-failed",
      requestId,
      diagnostics,
      fatal: !toolchainLoaded,
      message:
        diagnostics[0]?.message ||
        readableLog ||
        (error instanceof Error ? error.message : "Compilation failed"),
    });
  }
};
