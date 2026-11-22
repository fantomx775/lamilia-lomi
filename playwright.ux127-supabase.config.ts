import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const baseWithoutWebServer = { ...base, webServer: undefined };

// Real isolated backend campaign. Demo-only cases remain explicitly skipped;
// the separate local-dev functional campaign owns their actual execution.
export default defineConfig(baseWithoutWebServer, {
  workers: 1,
  use: { baseURL: "https://localhost:3443", ignoreHTTPSErrors: true, trace: "off", video: "off", screenshot: "off" },
  projects: base.projects?.filter((project) => ["chromium", "mobile", "webkit-mobile"].includes(project.name ?? "")),
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
