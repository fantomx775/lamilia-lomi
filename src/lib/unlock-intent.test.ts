import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieState = vi.hoisted(() => ({
  values: new Map<string, { value: string }>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieState.values.get(name),
    set: (name: string, value: string) => cookieState.values.set(name, { value }),
    delete: (name: string) => cookieState.values.delete(name),
  }),
}));

import {
  getUnlockIntent,
  setUnlockIntent,
  unlockIntentCookie,
} from "./unlock-intent";

describe("unlock intent cookies", () => {
  beforeEach(() => {
    cookieState.values.clear();
  });

  it("ignores legacy unbound codes while retaining their safe route context", async () => {
    const legacyPayload = Buffer.from(
      JSON.stringify({
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        returnTo: "/en/products/moon-garden-coloring-book",
        code: "LOMI-BOOK-2026",
        createdAt: Date.now(),
      }),
      "utf8",
    ).toString("base64url");
    cookieState.values.set(unlockIntentCookie, { value: legacyPayload });

    await expect(getUnlockIntent()).resolves.toMatchObject({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: undefined,
    });
  });

  it("retains an explicitly submitted guest code for the first account handoff", async () => {
    await setUnlockIntent({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    });

    await expect(getUnlockIntent()).resolves.toMatchObject({
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    });
  });
});
