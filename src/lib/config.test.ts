import { describe, expect, it } from "vitest";

import { getLocaleConfig, normalizeLocale } from "./locale";
import { getMissingPublicEnv, getPublicEnv } from "./config";

describe("app configuration", () => {
  it("reads public environment values with safe fallbacks", () => {
    const env = getPublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_123",
      NEXT_PUBLIC_APP_URL: "https://lamilialomi.com",
    });

    expect(env).toEqual({
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "sb_publishable_123",
      appUrl: "https://lamilialomi.com",
    });
    expect(getMissingPublicEnv({})).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]);
  });

  it("exposes supported locale configuration", () => {
    expect(getLocaleConfig()).toEqual({
      locales: ["en", "pl", "de", "es"],
      defaultLocale: "en",
    });
    expect(normalizeLocale("pl")).toBe("pl");
    expect(normalizeLocale("de")).toBe("de");
    expect(normalizeLocale("fr")).toBe("en");
  });
});
