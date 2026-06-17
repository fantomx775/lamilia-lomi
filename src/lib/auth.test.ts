import { describe, expect, it } from "vitest";

import {
  buildAuthRedirect,
  createDemoSession,
  hasAdminAccess,
  isUnlockRegistrationContext,
  parseDemoSession,
  serializeDemoSession,
  validateRegistrationInput,
} from "./auth";

describe("auth behavior", () => {
  it("requires legal acceptance while keeping marketing consent optional", () => {
    const rejected = validateRegistrationInput({
      email: "reader@example.com",
      password: "password123",
      termsAccepted: false,
    });
    const accepted = validateRegistrationInput({
      email: "reader@example.com",
      password: "password123",
      termsAccepted: true,
    });

    expect(rejected.ok).toBe(false);
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        marketingConsent: false,
      },
    });
  });

  it("preserves safe return URLs and rejects external redirects", () => {
    expect(
      buildAuthRedirect({
        locale: "en",
        redirectTo: "/en/products/moon-garden-coloring-book",
        code: "LOMI-BOOK-2026",
      }),
    ).toBe("/en/products/moon-garden-coloring-book?code=LOMI-BOOK-2026");

    expect(
      buildAuthRedirect({
        locale: "en",
        redirectTo: "/admin",
      }),
    ).toBe("/admin");

    expect(
      buildAuthRedirect({
        locale: "en",
        redirectTo: "https://evil.example/phish",
      }),
    ).toBe("/en/library");
  });

  it("allows registration only in a product unlock context", () => {
    expect(
      isUnlockRegistrationContext({
        locale: "en",
        redirectTo: "/en/products/moon-garden-coloring-book",
      }),
    ).toBe(true);
    expect(isUnlockRegistrationContext({ locale: "en", code: "LOMI-BOOK-2026" })).toBe(
      true,
    );
    expect(isUnlockRegistrationContext({ locale: "en", redirectTo: "/en/library" })).toBe(
      false,
    );
  });

  it("detects admin access from role, not editable metadata", () => {
    expect(hasAdminAccess(createDemoSession({ email: "admin@lamilialomi.test" }))).toBe(
      true,
    );
    expect(hasAdminAccess(createDemoSession({ email: "demo@lamilialomi.test" }))).toBe(
      false,
    );
  });

  it("round-trips demo session cookie safely", () => {
    const session = createDemoSession({ email: "demo@lamilialomi.test" });
    const serialized = serializeDemoSession(session);

    expect(parseDemoSession(serialized)).toEqual(session);
    expect(parseDemoSession("not-json")).toBeNull();
  });
});
