import type { Page } from "@playwright/test";

export function isLoopbackPlaywrightTarget(baseURL: unknown): boolean {
  if (typeof baseURL !== "string" || !baseURL.trim()) return false;

  try {
    const target = new URL(baseURL);
    if (target.protocol !== "http:" && target.protocol !== "https:") return false;
    if (target.username || target.password) return false;

    const hostname = target.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function hasLocalDemoBackendProof(
  baseURL: unknown,
  email: string,
  password: string,
): boolean {
  return isLoopbackPlaywrightTarget(baseURL) &&
    email === "demo@lamilialomi.test" &&
    password === "demo-password";
}

export async function isLocalDemoAppTarget(page: Page, baseURL: unknown): Promise<boolean> {
  if (!isLoopbackPlaywrightTarget(baseURL)) return false;

  const response = await page.goto("/en/login");
  if (!response?.ok()) {
    throw new Error("Could not verify local demo mode because the loopback login page did not load successfully.");
  }

  const email = await page.getByLabel("Email").inputValue();
  const password = await page.getByLabel("Password").inputValue();
  return hasLocalDemoBackendProof(baseURL, email, password);
}
