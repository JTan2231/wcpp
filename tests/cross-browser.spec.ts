import { expect, test, type Page } from "@playwright/test";

function status(page: Page) {
  return page.getByRole("status");
}

function stdout(page: Page) {
  return page.locator('[data-output="stdout"]');
}

async function run(page: Page, source: string, expectedStatus: string | RegExp) {
  await page.getByRole("textbox", { name: "main.cpp source code" }).fill(source);
  await page.getByRole("button", { name: "Compile & Run" }).click();
  await expect(status(page)).toHaveText(expectedStatus, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Compile & Run" })).toBeEnabled();
}

test("cold-loads Clang, runs C++20, reports errors, and reruns", async ({ page }) => {
  test.setTimeout(120_000);
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
      failures.push(`external request: ${request.url()}`);
    } else if (!url.pathname.startsWith("/wcpp/")) {
      failures.push(`request escaped /wcpp/: ${request.url()}`);
    }
  });

  await page.goto(`./?engine=${test.info().project.name}`);
  await expect(status(page)).toHaveText("Ready");

  await run(
    page,
    `#include <algorithm>
#include <iostream>
#include <ranges>
#include <vector>
int main() {
  std::vector<int> values{3, 1, 2};
  std::ranges::sort(values);
  for (int value : values) std::cout << value;
  std::cout << "\\n";
}
`,
    "Exited with code 0",
  );
  expect(await stdout(page).textContent()).toBe("123\n");

  await run(page, "int main() { return missing_name; }\n", /missing_name/);
  await expect(
    page.locator('[data-output="compiler"] li').first(),
  ).toContainText("main.cpp:1:21");

  await run(
    page,
    `#include <iostream>
int main() { std::cout << "recovered\\n"; }
`,
    "Exited with code 0",
  );
  expect(await stdout(page).textContent()).toBe("recovered\n");
  expect(failures, failures.join("\n")).toEqual([]);
});
