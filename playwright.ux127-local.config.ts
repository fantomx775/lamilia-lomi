import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

// Functional demo gate: all base projects, actual Next development mode.
// The private campaign runner sanitizes inherited provider/backend credentials.
export default defineConfig(base, {
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: {
    command: `${npmCommand} run dev -- --hostname 127.0.0.1 --port 3000`,
    cwd: process.cwd(),
    env: {
      LAMILIA_BACKEND: "local",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    url: "http://127.0.0.1:3000/en",
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    stdout: "pipe",
    stderr: "pipe",
  },
});
