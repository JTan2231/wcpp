import { expect, test, type Locator } from "@playwright/test";
import { fillEditor } from "./editor-helpers";

test.use({ actionTimeout: 5_000 });
test.setTimeout(15_000);

async function cursorAt(editor: Locator, position: number) {
  await expect.poll(() => editor.evaluate((element: HTMLTextAreaElement) => [
    element.selectionStart, element.selectionEnd,
  ]), { timeout: 5_000 }).toEqual([position, position]);
}

async function keys(editor: Locator, sequence: string[]) {
  for (const key of sequence) await editor.press(key);
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

test("starts in Normal, supports i/a/o and groups each insertion for undo", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Program input" });
  const field = page.locator(".editor-field").filter({ has: input });
  await expect(input).toHaveAttribute("readonly", "");
  await input.press("z");
  await expect(input).toHaveValue("");
  await input.press("i");
  await expect(input).not.toHaveAttribute("readonly");
  await input.pressSequentially("cat");
  await input.press("Escape");
  await expect(input).toHaveAttribute("readonly", "");
  await expect(field.locator('.editor-block-cursor[data-visible="true"]')).toHaveText("t");
  await cursorAt(input, 2);
  await input.press("u");
  await expect(input).toHaveValue("");
  await input.press("Control+r");
  await expect(input).toHaveValue("cat");

  await keys(input, ["g", "g", "a"]);
  await input.pressSequentially("O");
  await input.press("Escape");
  await expect(input).toHaveValue("cOat");
  await input.press("u");
  await expect(input).toHaveValue("cat");

  await input.press("o");
  await input.pressSequentially("dog");
  await input.press("Escape");
  await expect(input).toHaveValue("cat\ndog");
  await input.press("u");
  await expect(input).toHaveValue("cat");

  await keys(input, ["g", "g", "i"]);
  await input.pressSequentially("big ");
  await input.press("Escape");
  await expect(input).toHaveValue("big cat");
  await input.press("u");
  await expect(input).toHaveValue("cat");

  await keys(input, ["g", "g", "i", "Tab"]);
  await cursorAt(input, 4);
  await input.pressSequentially("temporary");
  await input.press("Control+w");
  await expect(input).toHaveValue("    cat");
  await cursorAt(input, 4);
  await input.pressSequentially("big ");
  await input.press("Escape");
  await expect(input).toHaveValue("    big cat");
  await input.press("u");
  await expect(input).toHaveValue("cat");
  await input.press("Control+r");
  await expect(input).toHaveValue("    big cat");
});

for (const name of ["C++ source code", "Program input"]) {
  test(`${name}: Enter and o keep indentation, cursor placement and undo history`, async ({ page }) => {
    const input = page.getByRole("textbox", { name, exact: true });
    const indentation = " ".repeat(12);
    await fillEditor(input, "");
    await keys(input, ["i", "Tab", "Tab", "Tab"]);
    await input.pressSequentially("first");
    await input.press("Enter");
    await expect(input).toHaveValue(`${indentation}first\n${indentation}`);
    await cursorAt(input, indentation.length * 2 + "first\n".length);
    await input.pressSequentially("second");
    await keys(input, ["Enter", "Enter"]);
    const before = `${indentation}first\n${indentation}second\n${indentation}\n${indentation}`;
    await expect(input).toHaveValue(before);
    await cursorAt(input, before.length);
    await keys(input, ["Escape", "u"]);
    await expect(input).toHaveValue("");
    await input.press("Control+r");
    await expect(input).toHaveValue(before);

    await keys(input, ["g", "g", "o"]);
    await expect(input).toHaveValue(`${indentation}first\n${indentation}\n${indentation}second\n${indentation}\n${indentation}`);
    await cursorAt(input, indentation.length * 2 + "first\n".length);
    await input.pressSequentially("between");
    const after = `${indentation}first\n${indentation}between\n${indentation}second\n${indentation}\n${indentation}`;
    await keys(input, ["Escape", "u"]);
    await expect(input).toHaveValue(before);
    await input.press("Control+r");
    await expect(input).toHaveValue(after);
  });
}

test("Enter preserves mixed indentation and handles line splits and selections", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Program input" });
  for (const example of [
    { before: "plain", start: 5, end: 5, after: "plain\n", cursor: 6 },
    { before: "\t  \tfirst\nnext", start: 9, end: 9, after: "\t  \tfirst\n\t  \t\nnext", cursor: 14 },
    { before: "    one two", start: 8, end: 8, after: "    one \n    two", cursor: 13 },
    { before: "    one", start: 2, end: 2, after: "  \n    one", cursor: 5 },
    { before: "    one two\n  three", start: 8, end: 14, after: "    one \n    three", cursor: 13 },
  ]) {
    await fillEditor(input, example.before);
    await input.press("i");
    await input.evaluate((element: HTMLTextAreaElement, { start, end }) => {
      element.setSelectionRange(start, end);
    }, example);
    await input.press("Enter");
    await expect(input).toHaveValue(example.after);
    await cursorAt(input, example.cursor);
    await keys(input, ["Escape", "u"]);
    await expect(input).toHaveValue(example.before);
  }
});

test("moves by characters, words, lines and document boundaries", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "C++ source code" });
  await fillEditor(input, "alpha beta\nx\n  final");
  await keys(input, ["g", "g"]);
  await cursorAt(input, 0);
  await input.press("h");
  await cursorAt(input, 0);
  await input.press("l");
  await cursorAt(input, 1);
  await keys(input, ["ArrowLeft", "w"]);
  await cursorAt(input, 6);
  await input.press("b");
  await cursorAt(input, 0);
  await input.press("$");
  await cursorAt(input, 9);
  await input.press("l");
  await cursorAt(input, 9);
  await input.press("0");
  await cursorAt(input, 0);
  await input.press("G");
  await cursorAt(input, 15);
  await keys(input, ["g", "g", "ArrowRight", "ArrowDown"]);
  await cursorAt(input, 11);
  await input.press("ArrowUp");
  await cursorAt(input, 1);

  await keys(input, ["w", "l", "j"]);
  await cursorAt(input, 11);
  await input.press("k");
  await cursorAt(input, 7);
  await keys(input, ["$", "j", "j"]);
  await cursorAt(input, 19);
  await expect(input).toHaveValue("alpha beta\nx\n  final");
});

test("Ctrl+arrows jump words and blocks, and Ctrl+W deletes to the same word boundary", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Program input" });
  const text = "alpha beta\nline\n \nnext block\n\nlast";
  await fillEditor(input, text);
  await keys(input, ["g", "g", "Control+ArrowRight"]);
  await cursorAt(input, 6);
  await input.press("Control+ArrowLeft");
  await cursorAt(input, 0);
  await input.press("Control+w");
  await expect(input).toHaveValue(text);
  await keys(input, ["Control+ArrowRight", "Control+w"]);
  await expect(input).toHaveValue(text.slice(6));
  await cursorAt(input, 0);
  await input.press("u");
  await expect(input).toHaveValue(text);
  await cursorAt(input, 6);
  await input.press("Control+ArrowLeft");
  await input.press("Control+ArrowDown");
  await cursorAt(input, text.indexOf("next"));
  await input.press("Control+ArrowDown");
  await cursorAt(input, text.indexOf("last"));
  await input.press("Control+ArrowUp");
  await cursorAt(input, text.indexOf("next"));
  await input.press("Control+ArrowUp");
  await cursorAt(input, 0);

  await keys(input, ["i", "Control+ArrowRight"]);
  await input.pressSequentially("new ");
  await input.press("Escape");
  await expect(input).toHaveValue(text.replace("beta", "new beta"));
  await input.press("u");
  await expect(input).toHaveValue(text);
});

test("unfinished commands cancel on Escape, other commands and focus changes", async ({ page }) => {
  const source = page.getByRole("textbox", { name: "C++ source code" });
  const input = page.getByRole("textbox", { name: "Program input" });
  await fillEditor(source, "one\ntwo");
  await keys(source, ["g", "g", "d", "Escape", "d", "h", "j"]);
  await expect(source).toHaveValue("one\ntwo");
  await cursorAt(source, 4);
  await source.press("g");
  await input.focus();
  await source.press("g");
  await cursorAt(source, 4);
  await source.press("g");
  await cursorAt(source, 0);
});

for (const example of [
  { name: "first line", before: "one\ntwo\nthree", movement: ["g", "g"], after: "two\nthree" },
  { name: "middle line", before: "one\ntwo\nthree", movement: ["g", "g", "j"], after: "one\nthree" },
  { name: "last line without newline", before: "one\ntwo", movement: ["G"], after: "one" },
  { name: "line before a trailing newline", before: "one\ntwo\n", movement: ["g", "g", "j"], after: "one\n" },
  { name: "blank line", before: "one\n\nthree", movement: ["g", "g", "j"], after: "one\nthree" },
  { name: "only line", before: "one", movement: ["g", "g"], after: "" },
]) {
  test(`dd removes the ${example.name} and u restores exact text`, async ({ page }) => {
    const input = page.getByRole("textbox", { name: "Program input" });
    await fillEditor(input, example.before);
    await keys(input, [...example.movement, "d", "d"]);
    await expect(input).toHaveValue(example.after);
    await input.press("u");
    await expect(input).toHaveValue(example.before);
  });
}

for (const motion of ["ArrowUp", "ArrowDown", "k", "j"]) {
  test(`d then ${motion} deletes both whole lines with undo, redo and shared paste`, async ({ page }) => {
    const source = page.getByRole("textbox", { name: "C++ source code" });
    const input = page.getByRole("textbox", { name: "Program input" });
    const before = "one\n  two\nthree\n  four";
    await fillEditor(source, before);
    await keys(source, ["g", "g", "j"]);
    if (motion === "ArrowUp" || motion === "k") await source.press("j");
    await source.press("$");
    const originalCursor = await source.evaluate((element: HTMLTextAreaElement) => element.selectionStart);

    await keys(source, ["d", motion]);
    await expect(source).toHaveValue("one\n  four");
    await cursorAt(source, 6);
    await expect(source).toHaveAttribute("readonly", "");
    await source.press("u");
    await expect(source).toHaveValue(before);
    await cursorAt(source, originalCursor);
    await source.press("Control+r");
    await expect(source).toHaveValue("one\n  four");
    await cursorAt(source, 6);
    await input.press("p");
    await expect(input).toHaveValue("  two\nthree");
    await cursorAt(input, 2);
  });
}

for (const example of [
  { name: "first two lines", before: "one\ntwo\nthree", movement: ["g", "g"], motion: "ArrowDown", after: "three", cursor: 0 },
  { name: "last two lines", before: "one\ntwo\nthree", movement: ["G"], motion: "ArrowUp", after: "one", cursor: 0 },
  { name: "lines before a trailing newline", before: "one\ntwo\nthree\n", movement: ["g", "g", "j"], motion: "ArrowDown", after: "one\n", cursor: 4 },
  { name: "trailing empty line and its predecessor", before: "one\ntwo\nthree\n", movement: ["G"], motion: "ArrowUp", after: "one\ntwo", cursor: 4 },
  { name: "blank neighboring line", before: "one\n\nthree", movement: ["g", "g"], motion: "ArrowDown", after: "three", cursor: 0 },
  { name: "entire two-line document", before: "one\ntwo", movement: ["g", "g"], motion: "ArrowDown", after: "", cursor: 0 },
]) {
  test(`directional deletion handles the ${example.name}`, async ({ page }) => {
    const input = page.getByRole("textbox", { name: "Program input" });
    await fillEditor(input, example.before);
    await keys(input, [...example.movement, "d", example.motion]);
    await expect(input).toHaveValue(example.after);
    await cursorAt(input, example.cursor);
    await input.press("u");
    await expect(input).toHaveValue(example.before);
  });
}

test("directional deletion at document boundaries preserves text, register and history", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Program input" });
  await fillEditor(input, "one\ntwo");
  await keys(input, ["g", "g", "y", "y", "d", "ArrowUp", "d", "k"]);
  await expect(input).toHaveValue("one\ntwo");
  await cursorAt(input, 0);
  await keys(input, ["G", "d", "ArrowDown", "d", "j"]);
  await expect(input).toHaveValue("one\ntwo");
  await cursorAt(input, 4);
  await input.press("p");
  await expect(input).toHaveValue("one\ntwo\none");
  await keys(input, ["u", "u"]);
  await expect(input).toHaveValue("");
  await keys(input, ["d", "ArrowUp", "d", "ArrowDown", "p"]);
  await expect(input).toHaveValue("one");
  await keys(input, ["d", "ArrowUp", "d", "ArrowDown"]);
  await expect(input).toHaveValue("one");
});

test("yy/p preserve whole lines and share yanks across independent editors", async ({ page }) => {
  const source = page.getByRole("textbox", { name: "C++ source code" });
  const input = page.getByRole("textbox", { name: "Program input" });
  await fillEditor(source, "one\ntwo");
  await keys(source, ["g", "g", "y", "y", "p"]);
  await expect(source).toHaveValue("one\none\ntwo");
  await cursorAt(source, 4);
  await input.press("p");
  await expect(input).toHaveValue("one");
  await input.press("u");
  await expect(input).toHaveValue("");
  await expect(source).toHaveValue("one\none\ntwo");
  await source.press("u");
  await expect(source).toHaveValue("one\ntwo");
  await keys(source, ["G", "d", "d", "p"]);
  await expect(source).toHaveValue("one\ntwo");
  await keys(source, ["y", "y", "p"]);
  await expect(source).toHaveValue("one\ntwo\ntwo");
});

test("empty documents and empty yanked lines remain editable", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Program input" });
  await keys(input, ["d", "d", "x", "p", "G", "g", "g", "w", "b", "j", "k"]);
  await expect(input).toHaveValue("");
  await cursorAt(input, 0);
  await fillEditor(input, "one\n\nlast");
  await keys(input, ["g", "g", "j", "y", "y", "G", "p"]);
  await expect(input).toHaveValue("one\n\nlast\n");
  await input.press("a");
  await input.pressSequentially("new");
  await input.press("Escape");
  await expect(input).toHaveValue("one\n\nlast\nnew");
});

test("x/p and movements keep emoji and combining characters intact", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Program input" });
  const family = "👨‍👩‍👧‍👦";
  await fillEditor(input, `a${family}éz`);
  await keys(input, ["g", "g"]);
  await cursorAt(input, 0);
  await input.press("l");
  await cursorAt(input, 1);
  await input.press("x");
  await expect(input).toHaveValue("aéz");
  await input.press("u");
  await expect(input).toHaveValue(`a${family}éz`);
  await cursorAt(input, 1);
  await keys(input, ["l", "x"]);
  await expect(input).toHaveValue(`a${family}z`);
  await input.press("p");
  await expect(input).toHaveValue(`a${family}zé`);
  await input.press("u");
  await expect(input).toHaveValue(`a${family}z`);
});

test("native undo shortcuts include custom edits and new typing clears redo", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Program input" });
  await fillEditor(input, "one\ntwo");
  await keys(input, ["d", "d", "ControlOrMeta+z"]);
  await expect(input).toHaveValue("one\ntwo");
  await input.press("ControlOrMeta+Shift+z");
  await expect(input).toHaveValue("one");
  await input.press("a");
  await input.pressSequentially("!");
  await input.press("ControlOrMeta+z");
  await expect(input).toHaveValue("one");
  await input.pressSequentially("?");
  await input.press("Escape");
  await input.press("Control+r");
  await expect(input).toHaveValue("o?ne");
  await input.press("u");
  await expect(input).toHaveValue("one");
});

test("native clipboard and mouse selection work with Tab insertion and Shift+Tab navigation", async ({ page }) => {
  const source = page.getByRole("textbox", { name: "C++ source code" });
  const input = page.getByRole("textbox", { name: "Program input" });
  await fillEditor(source, "copy this");
  await keys(source, ["ControlOrMeta+a", "ControlOrMeta+c"]);
  await input.press("ControlOrMeta+v");
  await expect(input).toHaveValue("copy this");
  await input.press("u");
  await expect(input).toHaveValue("");
  await input.press("i");
  await input.press("ControlOrMeta+v");
  await expect(input).toHaveValue("copy this");
  await input.press("Escape");
  await input.press("u");
  await expect(input).toHaveValue("");
  await keys(source, ["ControlOrMeta+a", "ControlOrMeta+x"]);
  await expect(source).toHaveValue("");
  await source.press("u");
  await expect(source).toHaveValue("copy this");
  await source.press("Tab");
  await expect(source).toHaveValue("    copy this");
  await expect(source).toBeFocused();
  await cursorAt(source, 4);
  await source.press("u");
  await expect(source).toHaveValue("copy this");
  await keys(source, ["ControlOrMeta+a", "Tab"]);
  await expect(source).toHaveValue("    ");
  await source.press("u");
  await expect(source).toHaveValue("copy this");
  await keys(source, ["ControlOrMeta+a", "Control+w"]);
  await expect(source).toHaveValue("");
  await source.press("u");
  await expect(source).toHaveValue("copy this");
  await input.press("Shift+Tab");
  await expect(source).toBeFocused();
  await source.click({ position: { x: 24, y: 20 } });
  const position = await source.evaluate((element: HTMLTextAreaElement) => element.selectionStart);
  expect(position).toBeLessThan(4);
  await source.press("x");
  await expect(source).not.toHaveValue("copy this");
});

test("the block cursor follows scrolling, tabs and narrow layouts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  const input = page.getByRole("textbox", { name: "C++ source code" });
  const longLine = "\t" + "x".repeat(140);
  await fillEditor(input, Array.from({ length: 70 }, (_, index) => index === 69 ? longLine : `line ${index}`).join("\n"));
  await keys(input, ["G", "$"]);
  const caret = page.locator('.editor-block-cursor[data-visible="true"]');
  await expect(caret).toBeVisible();
  const bounds = await input.boundingBox();
  const block = await caret.boundingBox();
  expect(bounds).not.toBeNull();
  expect(block).not.toBeNull();
  expect(block!.x).toBeGreaterThan(bounds!.x);
  expect(block!.x + block!.width).toBeLessThan(bounds!.x + bounds!.width);
  expect(block!.y).toBeGreaterThan(bounds!.y);
  expect(block!.y + block!.height).toBeLessThan(bounds!.y + bounds!.height);
  await keys(input, ["g", "g"]);
  await expect.poll(() => input.evaluate((element: HTMLTextAreaElement) => [element.scrollLeft, element.scrollTop])).toEqual([0, 0]);
  await input.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => input.evaluate((element: HTMLTextAreaElement) => element.scrollTop)).toBeGreaterThan(0);
  await keys(input, ["g", "g"]);
  await expect.poll(() => input.evaluate((element: HTMLTextAreaElement) => element.scrollTop)).toBe(0);
});

test("Ctrl+' uses the Run/Cancel action from either editor and mode", async ({ page }) => {
  test.setTimeout(120_000);
  const source = page.getByRole("textbox", { name: "C++ source code" });
  const input = page.getByRole("textbox", { name: "Program input" });
  const status = page.getByRole("status");
  const output = page.getByRole("region", { name: "stdout", exact: true });
  const run = page.getByRole("button", { name: "Run", exact: true });

  // The default cf template also runs when neither editor has focus.
  await page.keyboard.press("Control+'");
  await expect(status).toHaveText("Exited with code 0");
  await expect(output).toHaveText("No output.");

  const targets = [
    { editor: source, insert: false },
    { editor: source, insert: true },
    { editor: input, insert: false },
    { editor: input, insert: true },
  ];
  for (const [index, target] of targets.entries()) {
    const code = `#include <iostream>
int main() { int value; std::cin >> value; std::cout << value + ${index}; }
`;
    const stdin = String(40 + index);
    await fillEditor(source, code);
    await fillEditor(input, stdin);
    await target.editor.focus();
    if (target.insert) await target.editor.press("i");
    await target.editor.press("Control+'");
    await expect(status).toHaveText("Exited with code 0");
    await expect(output).toHaveText(String(40 + 2 * index));
    await expect(run).toBeEnabled();
    await expect(target.editor).toBeFocused();
    await expect(source).toHaveValue(code);
    await expect(input).toHaveValue(stdin);
    if (target.insert) await expect(target.editor).not.toHaveAttribute("readonly");
    else await expect(target.editor).toHaveAttribute("readonly", "");
  }

  await fillEditor(source, " ");
  await source.press("i");
  await source.press("Control+'");
  await expect(run).toBeDisabled();
  await expect(status).toHaveText("Exited with code 0");
  await expect(source).toHaveValue(" ");

  await fillEditor(source, "int main() { for (;;) {} }\n");
  await page.keyboard.down("Control");
  await page.keyboard.down("'");
  // Holding the shortcut must not immediately cancel the run.
  await page.keyboard.down("'");
  await page.keyboard.up("'");
  await page.keyboard.up("Control");
  await expect(status).toHaveText("Running…");
  await input.press("Control+'");
  await expect(status).toHaveText("Cancelled");
  await expect(run).toBeEnabled();

  await fillEditor(source, "int main() {}\n");
  await run.click();
  await expect(status).toHaveText("Exited with code 0");
});
