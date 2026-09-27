const characters = new Intl.Segmenter(undefined, { granularity: "grapheme" });
let indexedText = "";
let boundaries = [0];

function boundaryIndex(text: string, cursor: number): number {
  if (text !== indexedText) {
    // WebKit's containing() can include the preceding character for joined
    // emoji. Iterating segments gives consistent boundaries in all three engines.
    boundaries = Array.from(characters.segment(text), (character) => character.index);
    boundaries.push(text.length);
    indexedText = text;
  }
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (boundaries[middle] <= cursor) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export function nextCharacter(text: string, cursor: number): number {
  const index = boundaryIndex(text, cursor);
  return boundaries[Math.min(index + 1, boundaries.length - 1)];
}

export function previousCharacter(text: string, cursor: number): number {
  const index = boundaryIndex(text, cursor - 1);
  return boundaries[index];
}

export function lineAt(text: string, cursor: number) {
  const start = cursor > 0 ? text.lastIndexOf("\n", cursor - 1) + 1 : 0;
  const newline = text.indexOf("\n", cursor);
  return { start, end: newline === -1 ? text.length : newline };
}

export function normalCursor(text: string, position: number): number {
  const cursor = Math.max(0, Math.min(position, text.length));
  const line = lineAt(text, cursor);
  if (cursor === line.end && cursor > line.start) {
    return previousCharacter(text, cursor);
  }
  const index = boundaryIndex(text, cursor);
  return boundaries[index];
}

function wordKind(text: string, cursor: number): number {
  const character = text.slice(cursor, nextCharacter(text, cursor));
  if (/\s/u.test(character)) return 0;
  return /[\p{L}\p{N}\p{M}_]/u.test(character) ? 1 : 2;
}

export function moveWord(text: string, cursor: number, direction: -1 | 1): number {
  if (direction === 1) {
    const kind = wordKind(text, cursor);
    while (cursor < text.length && wordKind(text, cursor) === kind) {
      cursor = nextCharacter(text, cursor);
    }
    while (cursor < text.length && wordKind(text, cursor) === 0) {
      cursor = nextCharacter(text, cursor);
    }
  } else {
    cursor = previousCharacter(text, cursor);
    while (cursor > 0 && wordKind(text, cursor) === 0) {
      cursor = previousCharacter(text, cursor);
    }
    const kind = wordKind(text, cursor);
    while (cursor > 0) {
      const previous = previousCharacter(text, cursor);
      if (wordKind(text, previous) !== kind) break;
      cursor = previous;
    }
  }
  return cursor;
}

export function moveBlock(text: string, cursor: number, direction: -1 | 1): number {
  const starts: number[] = [];
  let offset = 0;
  let previousWasBlank = true;
  for (const line of text.split("\n")) {
    const blank = line.trim().length === 0;
    if (!blank && previousWasBlank) starts.push(offset);
    previousWasBlank = blank;
    offset += line.length + 1;
  }
  if (direction === 1) return starts.find((start) => start > cursor) ?? text.length;
  return starts.reverse().find((start) => start < cursor) ?? 0;
}

export function firstNonblank(text: string, cursor: number): number {
  const line = lineAt(text, cursor);
  const offset = text.slice(line.start, line.end).search(/\S/u);
  return line.start + Math.max(0, offset);
}
