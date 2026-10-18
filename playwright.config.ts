import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "webkit-product-editor",
      testMatch: "**/product-editor-ux.spec.ts",
      use: { ...devices["Desktop Safari"], browserName: "webkit" },
    },
    {
      name: "webkit-mobile-product-editor",
      testMatch: "**/product-editor-ux.spec.ts",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
    {
      name: "webkit-mobile",
      testMatch: "**/issue-30-supabase-auth.spec.ts",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run dev",
        env: {
          LAMILIA_BACKEND: "local",
          NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
          LAMILIA_TEST_PRODUCT_DETAIL_DELAY_MS:
            process.env.LAMILIA_TEST_PRODUCT_DETAIL_DELAY_MS ?? "",
          LAMILIA_TEST_PRODUCT_ACCESS_DELAY_MS:
            process.env.LAMILIA_TEST_PRODUCT_ACCESS_DELAY_MS ?? "",
          LAMILIA_TEST_CATALOG_LOADING_DELAY_MS:
            process.env.LAMILIA_TEST_CATALOG_LOADING_DELAY_MS ?? "",
        },
        url: "http://127.0.0.1:3000/en",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
