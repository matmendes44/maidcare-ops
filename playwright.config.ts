import { defineConfig } from "@playwright/test";

// Browser tests: npm run test:e2e. They run against the dev server, the
// Stripe sandbox and the dev database, never production (the fixtures
// refuse a live Stripe key). Uses the installed Google Chrome.
try {
  process.loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  // the tests share one database and Stripe sandbox: one at a time
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: "chrome",
    headless: true,
    viewport: { width: 1366, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
