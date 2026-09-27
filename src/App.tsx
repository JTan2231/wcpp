import { useEffect, useRef, useState } from "react";

import VimEditor, { type Yank } from "./editor/VimEditor";

import type {
  CompilerClient,
  CompilerPhase,
  CompilerWorkerEvent,
} from "./protocol";

const DEFAULT_SOURCE = `#include <iostream>
#include <vector>

using namespace std;

void solve() {

}

int main() {
    ios_base::sync_with_stdio(0);
    cin.tie(0); cout.tie(0);
    int tc = 1;
    // cin >> tc;
    for (int t = 1; t <= tc; t++) {
        // cout << "Case #" << t << ": ";
        solve();
    }
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

export default function App({ compilerClient }: AppProps) {
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [stdin, setStdin] = useState("");
  const yankRegister = useRef<Yank | null>(null);
  const [phase, setPhase] = useState<CompilerPhase>("idle");
  const [status, setStatus] = useState(
    compilerClient ? "" : "Compiler client is not connected",
  );
  const [stdout, setStdout] = useState("");
  const runButton = useRef<HTMLButtonElement>(null);
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
    setStatus("");

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
        case "stdout":
          setStdout((current) => current + event.chunk);
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

  useEffect(() => {
    const handleRunShortcut = (event: KeyboardEvent) => {
      if (
        event.key !== "'" || !event.ctrlKey || event.metaKey ||
        event.altKey || event.shiftKey || event.isComposing
      ) return;

      event.preventDefault();
      if (!event.repeat) runButton.current?.click();
    };

    window.addEventListener("keydown", handleRunShortcut);
    return () => window.removeEventListener("keydown", handleRunShortcut);
  }, []);

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
    setStdout("");

    try {
      compilerClient.compileAndRun({
        requestId,
        files: [{ path: "main.cpp", contents: source }],
        stdin,
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
          ref={runButton}
          className="button"
          type="button"
          aria-keyshortcuts="Control+'"
          title="Run / Cancel (Ctrl+')"
          onClick={isActive ? cancel : compileAndRun}
          disabled={!isActive && source.trim().length === 0}
        >
          {isActive ? "Cancel" : "Run"}
        </button>
      </div>

      <div className="editors">
        <VimEditor
          id="source-editor"
          ariaLabel="C++ source code"
          className="source-editor"
          value={source}
          onChange={setSource}
          register={yankRegister}
        />
        <VimEditor
          id="stdin-editor"
          ariaLabel="Program input"
          className="stdin-editor"
          value={stdin}
          onChange={setStdin}
          register={yankRegister}
          placeholder="Press i to enter input for your program."
        />
      </div>

      <details className="editor-help">
        <summary id="editor-shortcuts">Keyboard shortcuts</summary>
        <div className="editor-shortcuts">
          <span><kbd>Ctrl+'</kbd> run / cancel · <kbd>Esc</kbd> return to Normal</span>
          <span><kbd>i</kbd> insert before · <kbd>a</kbd> after · <kbd>o</kbd> new line below</span>
          <span><kbd>Enter</kbd> in Insert mode / <kbd>o</kbd> in Normal mode keep the current line's indentation</span>
          <span><kbd>h j k l</kbd> / arrows move · <kbd>w b</kbd> move by word</span>
          <span><kbd>0 $</kbd> line start / end · <kbd>gg G</kbd> first / last line</span>
          <span><kbd>x</kbd> delete character · <kbd>dd</kbd> delete line · <kbd>yy</kbd> copy line · <kbd>p</kbd> paste</span>
          <span><kbd>d↑</kbd> / <kbd>dk</kbd> delete current and previous line · <kbd>d↓</kbd> / <kbd>dj</kbd> delete current and next line</span>
          <span><kbd>u</kbd> undo · <kbd>Ctrl+r</kbd> redo · Cmd/Ctrl+Z also undoes</span>
          <span>Ctrl+←/→ words · Ctrl+↑/↓ blocks separated by blank lines, when available to the browser</span>
          <span><kbd>Ctrl+w</kbd> delete back one word · <kbd>Tab</kbd> insert 4 spaces · <kbd>Shift+Tab</kbd> leave editor</span>
        </div>
      </details>

      <div className="output">
        <div className="output-label" id="output-label">stdout</div>
        <div className="output-viewport">
          <pre
            id="output-panel-stdout"
            className="output-pane"
            role="region"
            aria-labelledby="output-label"
            data-output="stdout"
          >
            {stdout || "No output."}
          </pre>
        </div>
      </div>
    </main>
  );
}
