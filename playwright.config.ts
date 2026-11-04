import { defineConfig, devices } from "@playwright/test";
import { STATE } from "./tests/e2e/helpers";

// e2e flows run against a running app: `npm run dev` locally, or a deployed preview via BASE_URL.
// Global setup creates one demo workspace per run; every test shares it through storageState.
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  // A retry would replay one-shot actions (a fee paid, a duplicate merged) the first attempt already made.
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3201",
    storageState: STATE,
    trace: "retain-on-failure",
    navigationTimeout: 90_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
