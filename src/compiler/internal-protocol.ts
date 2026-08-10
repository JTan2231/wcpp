import type { CompilerDiagnostic } from "../protocol";

export type BuildWorkerCommand = {
  type: "build";
  requestId: string;
  source: string;
};

export type BuildWorkerEvent =
  | {
      type: "phase";
      requestId: string;
      message: string;
    }
  | {
      type: "built";
      requestId: string;
      wasm: ArrayBuffer;
      diagnostics: CompilerDiagnostic[];
    }
  | {
      type: "build-failed";
      requestId: string;
      message: string;
      diagnostics: CompilerDiagnostic[];
      fatal: boolean;
    };

export type RunWorkerCommand = {
  type: "run";
  requestId: string;
  wasm: ArrayBuffer;
  args: string[];
  stdin: string;
  outputLimitBytes: number;
};

export type RunWorkerEvent =
  | { type: "started"; requestId: string }
  | { type: "stdout"; requestId: string; chunk: string }
  | { type: "stderr"; requestId: string; chunk: string }
  | { type: "exited"; requestId: string; exitCode: number }
  | { type: "run-failed"; requestId: string; message: string };
