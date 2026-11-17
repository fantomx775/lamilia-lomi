import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/issue-127-benchmark.spec.mjs",
  outputDir: ".task/ux127/benchmark-test-results",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "https://localhost:3443", ignoreHTTPSErrors: true, trace: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node scripts/testing/issue-127-production-server.mjs",
    cwd: process.cwd(),
    url: "https://localhost:3443/en",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    stdout: "pipe", stderr: "pipe",
  },
});
