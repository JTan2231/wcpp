export type CompilerPhase =
  | "idle"
  | "compiling"
  | "running"
  | "cancelling"
  | "finished"
  | "cancelled"
  | "failed";

export type DiagnosticSeverity = "error" | "warning" | "note";

export interface SourceFile {
  path: string;
  contents: string;
}

export interface CompilerDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface CompileAndRunRequest {
  requestId: string;
  files: SourceFile[];
  args?: string[];
  stdin?: string;
}

export type CompilerWorkerCommand =
  | ({ type: "compile-and-run" } & CompileAndRunRequest)
  | { type: "cancel"; requestId: string };

export type CompilerWorkerEvent =
  | {
      type: "phase";
      requestId: string;
      phase: "compiling" | "running";
      message?: string;
    }
  | {
      type: "diagnostics";
      requestId: string;
      diagnostics: CompilerDiagnostic[];
    }
  | { type: "stdout"; requestId: string; chunk: string }
  | { type: "stderr"; requestId: string; chunk: string }
  | {
      type: "finished";
      requestId: string;
      exitCode: number;
      durationMs?: number;
    }
  | { type: "cancelled"; requestId: string }
  | {
      type: "failed";
      requestId: string;
      stage: "compiler" | "runtime" | "client";
      message: string;
    };

export type CompilerEventListener = (event: CompilerWorkerEvent) => void;

/**
 * UI-facing boundary for the browser compiler and runner workers.
 */
export interface CompilerClient {
  compileAndRun(request: CompileAndRunRequest): void;
  cancel(requestId: string): void;
  subscribe(listener: CompilerEventListener): () => void;
}
