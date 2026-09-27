import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";

import {
  firstNonblank,
  lineAt,
  moveBlock,
  moveWord,
  nextCharacter,
  normalCursor,
  previousCharacter,
} from "./motions";

export interface Yank {
  text: string;
  linewise: boolean;
}

interface Snapshot {
  text: string;
  cursor: number;
}

interface VimEditorProps {
  id: string;
  ariaLabel: string;
  className: string;
  value: string;
  onChange(value: string): void;
  register: MutableRefObject<Yank | null>;
  placeholder?: string;
}

export default function VimEditor({
  id,
  ariaLabel,
  className,
  value,
  onChange,
  register,
  placeholder,
}: VimEditorProps) {
  const [mode, setMode] = useState<"normal" | "insert">("normal");
  const [cursor, setCursor] = useState(0);
  const [cursorRequest, setCursorRequest] = useState(0);
  const [pending, setPending] = useState("");
  const [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const blockCursor = useRef<HTMLSpanElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const text = useRef(value);
  const selectionToApply = useRef<number | null>(null);
  const preferredColumn = useRef<number | null>(null);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const insertStart = useRef<Snapshot | null>(null);
  const composing = useRef(false);
  text.current = value;

  const snapshot = (): Snapshot => ({
    text: text.current,
    cursor: textarea.current?.selectionStart ?? cursor,
  });

  const remember = (before: Snapshot) => {
    undo.current.push(before);
    if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
  };

  const finishInsert = () => {
    const before = insertStart.current;
    if (before && before.text !== text.current) remember(before);
    insertStart.current = null;
  };

  const placeCursor = (position: number, nextMode = mode) => {
    const next = nextMode === "normal"
      ? normalCursor(text.current, position)
      : Math.max(0, Math.min(position, text.current.length));
    selectionToApply.current = next;
    setCursor(next);
    setCursorRequest((request) => request + 1);
    setSelected(false);
    // Also collapse selections when the requested position has not changed.
    textarea.current?.setSelectionRange(next, next);
  };

  const replace = (nextText: string, position: number, nextMode = mode) => {
    text.current = nextText;
    onChange(nextText);
    placeCursor(position, nextMode);
    preferredColumn.current = null;
  };

  const edit = (nextText: string, position: number) => {
    if (nextText !== text.current) remember(snapshot());
    replace(nextText, position);
  };

  const travelHistory = (backward: boolean) => {
    finishInsert();
    const from = backward ? undo.current : redo.current;
    const to = backward ? redo.current : undo.current;
    const previous = from.pop();
    if (!previous) return;
    to.push(snapshot());
    replace(previous.text, previous.cursor);
    setPending("");
  };

  const syncScroll = () => {
    const input = textarea.current;
    if (!input || !mirror.current || !viewport.current) return;
    mirror.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    viewport.current.style.width = `${input.clientWidth}px`;
    viewport.current.style.height = `${input.clientHeight}px`;
  };

  useLayoutEffect(() => {
    const input = textarea.current;
    const caret = blockCursor.current;
    if (!input || !caret) return;
    if (selectionToApply.current !== null) {
      const position = selectionToApply.current;
      selectionToApply.current = null;
      input.setSelectionRange(position, position);
      // Native selection changes do not reliably scroll a readonly textarea.
      const left = caret.offsetLeft;
      const padding = 10;
      const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight);
      const row = text.current.slice(0, position).split("\n").length - 1;
      const top = padding + row * lineHeight;
      if (left < input.scrollLeft + padding) input.scrollLeft = left - padding;
      if (left + caret.offsetWidth > input.scrollLeft + input.clientWidth - padding) {
        input.scrollLeft = left + caret.offsetWidth - input.clientWidth + padding;
      }
      if (top < input.scrollTop + padding) input.scrollTop = top - padding;
      if (top + lineHeight > input.scrollTop + input.clientHeight - padding) {
        input.scrollTop = top + lineHeight - input.clientHeight + padding;
      }
    }
    syncScroll();
  }, [value, cursor, mode, cursorRequest]);

  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    const observer = new ResizeObserver(syncScroll);
    observer.observe(input);
    return () => observer.disconnect();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
    const input = event.currentTarget;
    const position = input.selectionStart;
    const current = text.current;
    const line = lineAt(current, position);
    const key = event.key;

    if (key === "Escape") {
      event.preventDefault();
      finishInsert();
      setPending("");
      setMode("normal");
      const next = mode === "insert" && position > line.start
        ? previousCharacter(current, position)
        : position;
      placeCursor(next, "normal");
      preferredColumn.current = null;
      return;
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey && key.toLowerCase() === "z") {
      event.preventDefault();
      travelHistory(!event.shiftKey);
      return;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && key === "r") {
      event.preventDefault();
      travelHistory(false);
      return;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key.startsWith("Arrow")) {
      event.preventDefault();
      finishInsert();
      setPending("");
      const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
      placeCursor(key === "ArrowLeft" || key === "ArrowRight"
        ? moveWord(current, position, direction)
        : moveBlock(current, position, direction));
      preferredColumn.current = null;
      return;
    }
    const deleteWord = event.ctrlKey && key === "w";
    const insertSpaces = !event.ctrlKey && key === "Tab";
    if (!event.metaKey && !event.altKey && !event.shiftKey && (deleteWord || insertSpaces)) {
      event.preventDefault();
      setPending("");
      const end = input.selectionEnd;
      const start = deleteWord && position === end ? moveWord(current, position, -1) : position;
      const inserted = insertSpaces ? "    " : "";
      const next = current.slice(0, start) + inserted + current.slice(end);
      const nextPosition = start + inserted.length;
      if (mode === "insert") {
        insertStart.current ??= snapshot();
        replace(next, nextPosition);
      } else {
        edit(next, nextPosition);
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      setPending("");
      return;
    }

    if (mode === "insert") {
      if (/^(Arrow|Home|End|Page)/.test(key)) finishInsert();
      return;
    }
    // Keep browser text selection and Shift+Tab navigation available in Normal mode.
    if (event.shiftKey && /^(Arrow|Home|End|Page)/.test(key)) {
      setPending("");
      preferredColumn.current = null;
      return;
    }
    if (key === "Tab") {
      setPending("");
      return;
    }
    event.preventDefault();
    setPending("");

    if (pending === "g" && key === "g") {
      placeCursor(firstNonblank(current, 0));
    } else if (pending === "y" && key === "y") {
      register.current = { text: current.slice(line.start, line.end), linewise: true };
    } else if (pending === "d" && key === "d") {
      register.current = { text: current.slice(line.start, line.end), linewise: true };
      if (line.end < current.length) {
        const next = current.slice(0, line.start) + current.slice(line.end + 1);
        edit(next, firstNonblank(next, line.start));
      } else {
        const next = current.slice(0, Math.max(0, line.start - 1));
        edit(next, firstNonblank(next, next.length));
      }
    } else if (key === "g" || key === "d" || key === "y") {
      setPending(key);
    } else if (key === "i" || key === "a" || key === "o") {
      insertStart.current = snapshot();
      setMode("insert");
      if (key === "o") {
        replace(current.slice(0, line.end) + "\n" + current.slice(line.end), line.end + 1, "insert");
      } else {
        const at = key === "a" && position < line.end ? nextCharacter(current, position) : position;
        insertStart.current.cursor = at;
        placeCursor(at, "insert");
      }
    } else if (key === "h" || key === "ArrowLeft") {
      placeCursor(Math.max(line.start, previousCharacter(current, position)));
    } else if (key === "l" || key === "ArrowRight") {
      placeCursor(Math.min(line.end, nextCharacter(current, position)));
    } else if (key === "j" || key === "ArrowDown" || key === "k" || key === "ArrowUp") {
      const down = key === "j" || key === "ArrowDown";
      const goal = preferredColumn.current ?? position - line.start;
      const destination = down ? line.end + 1 : line.start - 1;
      if (destination >= 0 && destination <= current.length) {
        const target = lineAt(current, destination);
        placeCursor(Math.min(target.start + goal, target.end));
      }
      preferredColumn.current = goal;
      return;
    } else if (key === "w" || key === "b") {
      placeCursor(moveWord(current, position, key === "w" ? 1 : -1));
    } else if (key === "0" || key === "Home") {
      placeCursor(line.start);
    } else if (key === "$" || key === "End") {
      placeCursor(line.end);
      preferredColumn.current = Infinity;
      return;
    } else if (key === "G") {
      placeCursor(firstNonblank(current, current.length));
    } else if (key === "x" && position < line.end) {
      const end = nextCharacter(current, position);
      register.current = { text: current.slice(position, end), linewise: false };
      edit(current.slice(0, position) + current.slice(end), position);
    } else if (key === "p" && register.current) {
      const yank = register.current;
      if (yank.linewise) {
        if (current === "") edit(yank.text, firstNonblank(yank.text, 0));
        else {
          const next = current.slice(0, line.end) + "\n" + yank.text + current.slice(line.end);
          edit(next, firstNonblank(next, line.end + 1));
        }
      } else {
        const at = position < line.end ? nextCharacter(current, position) : position;
        const next = current.slice(0, at) + yank.text + current.slice(at);
        edit(next, previousCharacter(next, at + yank.text.length));
      }
    } else if (key === "u") {
      travelHistory(true);
    }
    preferredColumn.current = null;
  };

  const character = value.slice(cursor, nextCharacter(value, cursor));

  return (
    <div className="editor-field" data-mode={mode}>
      <div className="editor-surface">
        <textarea
          ref={textarea}
          id={id}
          className={className}
          value={value}
          readOnly={mode === "normal"}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={ariaLabel}
          aria-describedby="editor-shortcuts"
          placeholder={placeholder}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            insertStart.current ??= { text: text.current, cursor };
            const input = event.currentTarget;
            text.current = input.value;
            onChange(input.value);
            setCursor(input.selectionStart);
            setSelected(input.selectionStart !== input.selectionEnd);
          }}
          onSelect={(event) => {
            const input = event.currentTarget;
            const hasSelection = input.selectionStart !== input.selectionEnd;
            setSelected(hasSelection);
            if (mode === "normal" && !hasSelection) {
              const next = normalCursor(text.current, input.selectionStart);
              if (next !== input.selectionStart) input.setSelectionRange(next, next);
              setCursor(next);
            } else setCursor(input.selectionStart);
          }}
          onPointerDown={() => {
            finishInsert();
            setPending("");
            preferredColumn.current = null;
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            finishInsert();
            setFocused(false);
            setPending("");
          }}
          onScroll={syncScroll}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onPaste={(event) => {
            if (mode === "insert") return;
            event.preventDefault();
            const pasted = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
            if (!pasted) return;
            const input = event.currentTarget;
            const start = input.selectionStart;
            const next = text.current.slice(0, start) + pasted + text.current.slice(input.selectionEnd);
            edit(next, previousCharacter(next, start + pasted.length));
            setPending("");
          }}
          onCut={(event) => {
            if (mode === "insert") return;
            event.preventDefault();
            const input = event.currentTarget;
            const start = input.selectionStart;
            const end = input.selectionEnd;
            if (start === end) return;
            event.clipboardData.setData("text/plain", text.current.slice(start, end));
            edit(text.current.slice(0, start) + text.current.slice(end), start);
            setPending("");
          }}
        />
        <div className="editor-cursor-viewport" ref={viewport} aria-hidden="true">
          <div className="editor-cursor-mirror" ref={mirror}>
            {value.slice(0, cursor)}
            <span
              ref={blockCursor}
              className="editor-block-cursor"
              data-visible={focused && mode === "normal" && !selected}
            >{character && character !== "\n" ? character : " "}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
