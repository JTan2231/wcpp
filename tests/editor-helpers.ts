import type { Locator } from "@playwright/test";

export async function fillEditor(editor: Locator, text: string): Promise<void> {
  await editor.press("Escape");
  await editor.press("i");
  await editor.fill(text);
  await editor.press("Escape");
}
