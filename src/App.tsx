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
      <header className="toolbar">
        <div>
          <h1>wcpp</h1>
          <p>Compile and run main.cpp entirely in your browser.</p>
        </div>
        <button
          className={isActive ? "button button--cancel" : "button"}
          type="button"
          onClick={isActive ? cancel : compileAndRun}
          disabled={!isActive && source.trim().length === 0}
        >
          {isActive ? "Cancel" : "Compile & Run"}
        </button>
      </header>

      <section className="editor-panel" aria-labelledby="editor-label">
        <div className="panel-heading">
          <label id="editor-label" htmlFor="source-editor">
            main.cpp
          </label>
          <span className={`status status--${phase}`} role="status">
            {status}
          </span>
        </div>
        <textarea
          id="source-editor"
          className="source-editor"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          spellCheck={false}
          aria-label="main.cpp source code"
        />
      </section>

      <section className="diagnostics panel" aria-labelledby="diagnostics-title">
        <h2 id="diagnostics-title">Compiler diagnostics</h2>
        {diagnostics.length === 0 ? (
          <p className="empty-output">No diagnostics.</p>
        ) : (
          <ul>
            {diagnostics.map((diagnostic, index) => {
              const location = diagnosticLocation(diagnostic);
              return (
                <li key={`${location}-${index}`}>
                  <span className={`severity severity--${diagnostic.severity}`}>
                    {diagnostic.severity}
                  </span>
                  {location && <code>{location}</code>}
                  <span>{diagnostic.message}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="output-grid">
        <section className="panel" aria-labelledby="stdout-title">
          <h2 id="stdout-title">Program stdout</h2>
          <pre>{stdout || "No output."}</pre>
        </section>
        <section className="panel" aria-labelledby="stderr-title">
          <h2 id="stderr-title">Program stderr</h2>
          <pre className="stderr">{stderr || "No output."}</pre>
        </section>
      </div>
    </main>
  );
}
