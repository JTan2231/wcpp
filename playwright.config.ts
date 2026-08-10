import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 45_000,
  },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chrome",
      testMatch: /acceptance\.spec\.ts/,
      use: { browserName: "chromium", channel: "chrome" },
    },
    {
      name: "firefox",
      testMatch: /cross-browser\.spec\.ts/,
      use: { browserName: "firefox" },
    },
    {
      name: "webkit",
      testMatch: /cross-browser\.spec\.ts/,
      use: { browserName: "webkit" },
    },
  ],
  webServer: {
    command: "bun run serve",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
