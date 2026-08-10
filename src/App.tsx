import { useEffect, useRef, useState } from "react";

import type {
  CompilerClient,
  CompilerDiagnostic,
  CompilerPhase,
  CompilerWorkerEvent,
} from "./protocol";

const DEFAULT_SOURCE = `#include <iostream>

int main() {
  std::cout << "Hello from C++!\\n";
  return 0;
}
`;

const ACTIVE_PHASES = new Set<CompilerPhase>([
  "compiling",
  "running",
  "cancelling",
]);

interface AppProps {
  compilerClient?: CompilerClient;
}

type OutputView = "compiler" | "stdout" | "stderr";

const OUTPUT_VIEWS: OutputView[] = ["compiler", "stdout", "stderr"];

function makeRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function diagnosticLocation(diagnostic: CompilerDiagnostic): string {
  if (!diagnostic.file) return "";

  const line = diagnostic.line ? `:${diagnostic.line}` : "";
  const column = diagnostic.column ? `:${diagnostic.column}` : "";
  return `${diagnostic.file}${line}${column}`;
}

export default function App({ compilerClient }: AppProps) {
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [phase, setPhase] = useState<CompilerPhase>("idle");
  const [status, setStatus] = useState(
    compilerClient ? "Ready" : "Compiler client is not connected",
  );
  const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([]);
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const [outputView, setOutputView] = useState<OutputView>("compiler");
  const activeRequestId = useRef<string | null>(null);
  const activeCompilerClient = useRef<CompilerClient | null>(null);

  useEffect(() => {
    if (!compilerClient) {
      activeRequestId.current = null;
      activeCompilerClient.current = null;
      setPhase("idle");
      setStatus("Compiler client is not connected");
      return;
    }

    setPhase("idle");
    setStatus("Ready");

    const handleEvent = (event: CompilerWorkerEvent) => {
      if (
        activeCompilerClient.current !== compilerClient ||
        event.requestId !== activeRequestId.current
      ) {
        return;
      }

      switch (event.type) {
        case "phase":
          setPhase(event.phase);
          if (event.phase === "running") setOutputView("stdout");
          setStatus(
            event.message ??
              (event.phase === "compiling" ? "Compiling…" : "Running…"),
          );
          break;
        case "diagnostics":
          setDiagnostics(event.diagnostics);
          break;
        case "stdout":
          setStdout((current) => current + event.chunk);
          break;
        case "stderr":
          setStderr((current) => current + event.chunk);
          break;
        case "finished":
          setPhase("finished");
          setStatus(`Exited with code ${event.exitCode}`);
          activeRequestId.current = null;
          activeCompilerClient.current = null;
          break;
        case "cancelled":
          setPhase("cancelled");
          setStatus("Cancelled");
          activeRequestId.current = null;
          activeCompilerClient.current = null;
          break;
        case "failed":
          setPhase("failed");
          setStatus(event.message);
          activeRequestId.current = null;
          activeCompilerClient.current = null;
          break;
      }
    };

    const unsubscribe = compilerClient.subscribe(handleEvent);
    return () => {
      unsubscribe();

      if (activeCompilerClient.current !== compilerClient) return;
      const requestId = activeRequestId.current;
      activeRequestId.current = null;
      activeCompilerClient.current = null;
      if (requestId) compilerClient.cancel(requestId);
    };
  }, [compilerClient]);

  const isActive = ACTIVE_PHASES.has(phase);

  const compileAndRun = () => {
    if (!compilerClient) {
      setPhase("failed");
      setStatus("Compiler client is not connected");
      return;
    }

    const requestId = makeRequestId();
    activeRequestId.current = requestId;
    activeCompilerClient.current = compilerClient;
    setPhase("compiling");
    setStatus("Compiling…");
    setDiagnostics([]);
    setStdout("");
    setStderr("");
    setOutputView("compiler");

    try {
      compilerClient.compileAndRun({
        requestId,
        files: [{ path: "main.cpp", contents: source }],
      });
    } catch (error) {
      activeRequestId.current = null;
      activeCompilerClient.current = null;
      setPhase("failed");
      setStatus(error instanceof Error ? error.message : "Compilation failed");
    }
  };

  const cancel = () => {
    const requestId = activeRequestId.current;
    const requestClient = activeCompilerClient.current;
    if (!requestId || !requestClient) return;

    setPhase("cancelling");
    setStatus("Cancelling…");
    requestClient.cancel(requestId);
  };

  return (
    <main className="workspace">
      <div className="controls">
        <span className="status" role="status">
          {status}
        </span>
        <button
          className="button"
          type="button"
          onClick={isActive ? cancel : compileAndRun}
          disabled={!isActive && source.trim().length === 0}
        >
          {isActive ? "Cancel" : "Compile & Run"}
        </button>
      </div>

      <textarea
        id="source-editor"
        className="source-editor"
        value={source}
        onChange={(event) => setSource(event.target.value)}
        spellCheck={false}
        aria-label="main.cpp source code"
      />

      <div className="output">
        <div className="output-tabs" role="tablist" aria-label="Output">
          {OUTPUT_VIEWS.map((view) => (
            <button
              id={`output-tab-${view}`}
              className="output-tab"
              type="button"
              role="tab"
              aria-controls={`output-panel-${view}`}
              aria-selected={outputView === view}
              key={view}
              onClick={() => setOutputView(view)}
            >
              {view}
            </button>
          ))}
        </div>

        <div className="output-viewport">
          <div
            id="output-panel-compiler"
            className="output-pane diagnostics"
            role="tabpanel"
            aria-labelledby="output-tab-compiler"
            data-output="compiler"
            hidden={outputView !== "compiler"}
          >
            {diagnostics.length === 0 ? (
              <p>No diagnostics.</p>
            ) : (
              <ul>
                {diagnostics.map((diagnostic, index) => {
                  const location = diagnosticLocation(diagnostic);
                  return (
                    <li key={`${location}-${index}`}>
                      <span className="severity">{diagnostic.severity}</span>
                      {location && <code>{location}</code>}
                      <span>{diagnostic.message}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <pre
            id="output-panel-stdout"
            className="output-pane"
            role="tabpanel"
            aria-labelledby="output-tab-stdout"
            data-output="stdout"
            hidden={outputView !== "stdout"}
          >
            {stdout || "No output."}
          </pre>
          <pre
            id="output-panel-stderr"
            className="output-pane"
            role="tabpanel"
            aria-labelledby="output-tab-stderr"
            data-output="stderr"
            hidden={outputView !== "stderr"}
          >
            {stderr || "No output."}
          </pre>
        </div>
      </div>
    </main>
  );
}
