import { chromium, expect, test, type Page } from "@playwright/test";

const HELLO_SOURCE = `#include <iostream>
int main() {
  std::cout << "hello 42\\n";
  return 0;
}
`;

interface BrowserGuard {
  assertClean(): void;
}

function installBrowserGuard(page: Page): BrowserGuard {
  const failures: string[] = [];

  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    failures.push(`request failed: ${request.url()} (${request.failure()?.errorText})`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4173") {
      failures.push(`external request: ${request.method()} ${request.url()}`);
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      failures.push(`unexpected request method: ${request.method()} ${request.url()}`);
    }
  });
  page.on("websocket", (socket) => failures.push(`websocket: ${socket.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });

  return {
    assertClean() {
      expect(failures, failures.join("\n")).toEqual([]);
    },
  };
}

function editor(page: Page) {
  return page.getByRole("textbox", { name: "main.cpp source code" });
}

function status(page: Page) {
  return page.getByRole("status");
}

function output(page: Page, name: "Program stdout" | "Program stderr") {
  const stream = name === "Program stdout" ? "stdout" : "stderr";
  return page.locator(`[data-output="${stream}"]`);
}

function diagnostics(page: Page) {
  return page.locator('[data-output="compiler"]');
}

async function runSource(
  page: Page,
  source: string,
  expectedStatus: string | RegExp,
  timeout = 45_000,
): Promise<void> {
  await editor(page).fill(source);
  await page.getByRole("button", { name: "Compile & Run" }).click();
  await expect(status(page)).toHaveText(expectedStatus, { timeout });
  await expect(page.getByRole("button", { name: "Compile & Run" })).toBeEnabled();
}

async function openApp(page: Page): Promise<BrowserGuard> {
  const guard = installBrowserGuard(page);
  await page.goto("/");
  await expect(status(page)).toHaveText("Ready");
  return guard;
}

test("uses one monochrome Courier output viewport without headings", async ({
  page,
}) => {
  const guard = await openApp(page);

  await expect(page.locator("h1, h2, h3, h4, h5, h6")).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Output" })).toBeVisible();

  const styles = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const editor = getComputedStyle(document.querySelector("textarea")!);
    return {
      bodyColor: body.color,
      bodyBackground: body.backgroundColor,
      bodyFont: body.fontFamily,
      editorColor: editor.color,
      editorBackground: editor.backgroundColor,
      editorFont: editor.fontFamily,
    };
  });
  expect(styles).toEqual({
    bodyColor: "rgb(0, 0, 0)",
    bodyBackground: "rgb(255, 255, 255)",
    bodyFont: expect.stringContaining("Courier New"),
    editorColor: "rgb(0, 0, 0)",
    editorBackground: "rgb(255, 255, 255)",
    editorFont: expect.stringContaining("Courier New"),
  });

  const paneBounds = [];
  for (const view of ["compiler", "stdout", "stderr"] as const) {
    await page.getByRole("tab", { name: view }).click();
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    const bounds = await page.locator(`[data-output="${view}"]`).boundingBox();
    expect(bounds).not.toBeNull();
    paneBounds.push(bounds);
  }
  expect(paneBounds[1]).toEqual(paneBounds[0]);
  expect(paneBounds[2]).toEqual(paneBounds[0]);
  guard.assertClean();
});

test("cout, clean diagnostics, and normal exit", async ({ page }) => {
  const guard = await openApp(page);
  await runSource(page, HELLO_SOURCE, "Exited with code 0");

  expect(await output(page, "Program stdout").textContent()).toBe("hello 42\n");
  expect(await output(page, "Program stderr").textContent()).toBe("No output.");
  await expect(diagnostics(page)).toContainText("No diagnostics.");
  guard.assertClean();
});

test("reports an exact compiler error location", async ({ page }) => {
  const guard = await openApp(page);
  await runSource(
    page,
    `int main() {
  return missing_name;
}
`,
    /missing_name/,
  );

  const firstDiagnostic = diagnostics(page).locator("li").first();
  await expect(firstDiagnostic).toContainText("error");
  await expect(firstDiagnostic).toContainText("main.cpp:2:10");
  await expect(firstDiagnostic).toContainText(/missing_name.*undeclared|undeclared.*missing_name/);
  expect(await output(page, "Program stdout").textContent()).toBe("No output.");
  expect(await output(page, "Program stderr").textContent()).toBe("No output.");
  guard.assertClean();
});

test("supports vector, string, and sort", async ({ page }) => {
  const guard = await openApp(page);
  await runSource(
    page,
    `#include <algorithm>
#include <iostream>
#include <string>
#include <vector>

int main() {
  std::vector<std::string> values{"pear", "apple", "banana"};
  std::sort(values.begin(), values.end());
  for (const auto& value : values) std::cout << value << '\\n';
}
`,
    "Exited with code 0",
  );

  expect(await output(page, "Program stdout").textContent()).toBe("apple\nbanana\npear\n");
  expect(await output(page, "Program stderr").textContent()).toBe("No output.");
  await expect(diagnostics(page)).toContainText("No diagnostics.");
  guard.assertClean();
});

test("keeps stdout and stderr separate", async ({ page }) => {
  const guard = await openApp(page);
  await runSource(
    page,
    `#include <iostream>
int main() {
  std::cout << "stdout-line\\n";
  std::cerr << "stderr-line\\n";
}
`,
    "Exited with code 0",
  );

  expect(await output(page, "Program stdout").textContent()).toBe("stdout-line\n");
  expect(await output(page, "Program stderr").textContent()).toBe("stderr-line\n");
  guard.assertClean();
});

test("reports a nonzero exit code as a completed process", async ({ page }) => {
  const guard = await openApp(page);
  await runSource(page, "int main() { return 7; }\n", "Exited with code 7");

  expect(await output(page, "Program stdout").textContent()).toBe("No output.");
  expect(await output(page, "Program stderr").textContent()).toBe("No output.");
  guard.assertClean();
});

test("contains a Wasm trap and recovers on the next run", async ({ page }) => {
  const guard = await openApp(page);
  await runSource(page, "int main() { __builtin_trap(); }\n", /unreachable|trap/i);

  await runSource(page, HELLO_SOURCE, "Exited with code 0");
  expect(await output(page, "Program stdout").textContent()).toBe("hello 42\n");
  guard.assertClean();
});

test("terminates an infinite loop without freezing the page", async ({ page }) => {
  const guard = await openApp(page);
  await page.evaluate(() => {
    const statusElement = document.querySelector('[role="status"]');
    if (!statusElement) throw new Error("Missing status element");

    const timing: { runningAt: number | null; finishedAt: number | null } = {
      runningAt: null,
      finishedAt: null,
    };
    const record = () => {
      if (statusElement.textContent === "Running…" && timing.runningAt === null) {
        timing.runningAt = performance.now();
      }
      if (
        statusElement.textContent === "Execution timed out after 2 seconds" &&
        timing.finishedAt === null
      ) {
        timing.finishedAt = performance.now();
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(statusElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    Object.assign(window, {
      __executionTiming: timing,
      __executionTimingObserver: observer,
    });
  });
  await editor(page).fill(`#include <iostream>
int main() {
  std::cout << "loop-started\\n" << std::flush;
  for (;;) {}
}
`);
  await page.getByRole("button", { name: "Compile & Run" }).click();
  await expect(status(page)).toHaveText("Running…", { timeout: 45_000 });

  await expect(output(page, "Program stdout")).toHaveText("loop-started\n");
  await expect(status(page)).toHaveText("Running…");
  const action = await Promise.race([
    page.evaluate(() => document.querySelector("button.button")?.textContent),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("The browser main thread did not respond within 500 ms")), 500);
    }),
  ]);
  expect(action).toBe("Cancel");
  await expect(status(page)).toHaveText("Running…");
  await expect(status(page)).toHaveText("Execution timed out after 2 seconds", {
    timeout: 4_000,
  });
  const executionDuration = await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __executionTiming?: { runningAt: number | null; finishedAt: number | null };
      __executionTimingObserver?: MutationObserver;
    };
    runtimeWindow.__executionTimingObserver?.disconnect();
    const timing = runtimeWindow.__executionTiming;
    if (timing?.runningAt === null || timing?.finishedAt === null || !timing) {
      throw new Error("Execution timing was not captured");
    }
    return timing.finishedAt - timing.runningAt;
  });
  expect(executionDuration).toBeGreaterThanOrEqual(1_800);
  expect(executionDuration).toBeLessThan(4_000);

  await runSource(page, HELLO_SOURCE, "Exited with code 0");
  guard.assertClean();
});

test("caps program output at one megabyte and recovers", async ({ page }) => {
  test.setTimeout(120_000);
  const guard = await openApp(page);
  await runSource(
    page,
    `#include <iostream>
#include <string>
int main() {
  const std::string stdoutBlock(600003, 'o');
  const std::string stderrBlock(500009, 'e');
  std::cout.write(stdoutBlock.data(), stdoutBlock.size());
  std::cout.flush();
  std::cerr.write(stderrBlock.data(), stderrBlock.size());
  std::cerr.flush();
}
`,
    "Program output exceeded the 1 MB limit",
    90_000,
  );

  const stdoutStats = await output(page, "Program stdout").evaluate((element) => {
    const text = element.textContent ?? "";
    return {
      length: text.length,
      first: text.at(0),
      last: text.at(-1),
      hasUnexpectedCharacter: /[^o]/.test(text),
    };
  });
  const stderrStats = await output(page, "Program stderr").evaluate((element) => {
    const text = element.textContent ?? "";
    return {
      length: text.length,
      first: text.at(0),
      last: text.at(-1),
      hasUnexpectedCharacter: /[^e]/.test(text),
    };
  });
  expect(stdoutStats).toEqual({
    length: 600_003,
    first: "o",
    last: "o",
    hasUnexpectedCharacter: false,
  });
  expect(stderrStats).toEqual({
    length: 399_997,
    first: "e",
    last: "e",
    hasUnexpectedCharacter: false,
  });
  expect(stdoutStats.length + stderrStats.length).toBe(1_000_000);

  await runSource(page, HELLO_SOURCE, "Exited with code 0");
  guard.assertClean();
});

test("reuses the warm compiler for twenty consecutive builds", async ({ page }) => {
  test.setTimeout(180_000);
  const guard = installBrowserGuard(page);
  let toolchainRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/toolchain/v1/")) {
      toolchainRequests += 1;
    }
  });

  await page.goto("/");
  await expect(status(page)).toHaveText("Ready");

  await runSource(page, HELLO_SOURCE, "Exited with code 0");
  const requestsAfterFirstBuild = toolchainRequests;
  expect(requestsAfterFirstBuild).toBeGreaterThan(0);

  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    await runSource(
      page,
      `#include <iostream>
int main() { std::cout << "warm:${index}\\n"; }
`,
      "Exited with code 0",
      10_000,
    );
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(await output(page, "Program stdout").textContent()).toBe(`warm:${index}\n`);
    expect(await output(page, "Program stderr").textContent()).toBe("No output.");
    await expect(diagnostics(page)).toContainText("No diagnostics.");
  }

  expect(toolchainRequests).toBe(requestsAfterFirstBuild);
  guard.assertClean();
});

test("passes three true Chrome cold starts with same-origin static assets", async () => {
  test.setTimeout(210_000);
  const expectedToolchainAssets = [
    "bundle.js",
    "llvm-resources.tar",
    "llvm.core.wasm",
    "llvm.core2.wasm",
    "llvm.core3.wasm",
    "llvm.core4.wasm",
  ] as const;
  const expectedAssetCounts = Object.fromEntries(
    expectedToolchainAssets.map((asset) => [asset, 1]),
  );

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const guard = installBrowserGuard(page);
        const assetCounts = new Map<string, number>();
        const assetResponseFailures: string[] = [];

        page.on("response", (response) => {
          const url = new URL(response.url());
          if (!url.pathname.startsWith("/toolchain/v1/")) return;

          const asset = url.pathname.split("/").at(-1) ?? "";
          assetCounts.set(asset, (assetCounts.get(asset) ?? 0) + 1);
          if (response.status() !== 200) {
            assetResponseFailures.push(`${asset}: HTTP ${response.status()}`);
          }
          if (response.fromServiceWorker()) {
            assetResponseFailures.push(`${asset}: served by a service worker`);
          }
        });

        const started = performance.now();
        await page.goto(`http://127.0.0.1:4173/?cold=${iteration}`);
        await expect(status(page)).toHaveText("Ready");
        await runSource(page, HELLO_SOURCE, "Exited with code 0", 60_000);
        expect(performance.now() - started).toBeLessThan(60_000);
        expect(await output(page, "Program stdout").textContent()).toBe("hello 42\n");
        expect(Object.fromEntries(assetCounts)).toEqual(expectedAssetCounts);
        expect(assetResponseFailures).toEqual([]);
        guard.assertClean();
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
});
