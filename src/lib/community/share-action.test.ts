import { describe, expect, it } from "vitest";
import { communityShareAction } from "./share-action";
const base = { locale: "en" as const, authenticated: true, verified: true, access: "member" as const, unlockedProductIds: ["book-1"], productId: "book-1", productSlug: "moon-garden" };
describe("sharing readiness", () => {
  it("keeps the selected book through guest login", () => expect(communityShareAction({ ...base, authenticated: false }).href).toBe("/en/login?returnTo=%2Fen%2Flibrary%2Fcreations%3FproductId%3Dbook-1"));
  it("requires email verification", () => expect(communityShareAction({ ...base, verified: false }).label).toBe("Verify your email to share"));
  it("takes a reader without books to unlock", () => expect(communityShareAction({ ...base, productId: undefined, productSlug: undefined, unlockedProductIds: [] }).href).toBe("/en/unlock"));
  it("takes a reader with the wrong book to the selected book unlock", () => expect(communityShareAction({ ...base, unlockedProductIds: ["different"] }).href).toBe("/en/products/moon-garden#premium"));
  it("requires current participation before upload", () => expect(communityShareAction({ ...base, access: "join" }).href).toBe("/en/account"));
  it("takes an eligible reader directly to the selected book upload", () => expect(communityShareAction(base).href).toBe("/en/library/creations?productId=book-1"));
});
