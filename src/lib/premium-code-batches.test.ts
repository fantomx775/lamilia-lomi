import { describe, expect, it } from "vitest";

import { createPremiumCodeBatch, exportPremiumCodesToCsv } from "./premium-code-batches";
import { getSeedContentSnapshot } from "./content-store";

describe("premium code batches", () => {
  it("creates bounded batches of unique codes with 128 bits of random payload", () => {
    const codes = createPremiumCodeBatch({ productId: "product-id", count: 250 });

    expect(codes).toHaveLength(250);
    expect(new Set(codes.map((code) => code.code)).size).toBe(250);
    expect(codes.every((code) => code.productId === "product-id" && code.active)).toBe(true);
    expect(codes.every((code) => /^LL-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(code.code))).toBe(true);
    expect(new Set(codes.map((code) => code.id)).size).toBe(250);
  });

  it.each([0, -1, 251, 1.5, Number.NaN])("rejects invalid batch size %s", (count) => {
    expect(() => createPremiumCodeBatch({ productId: "product-id", count })).toThrow(RangeError);
  });

  it("skips codes already in the product code set", () => {
    const existing = createPremiumCodeBatch({ productId: "product-id", count: 1 })[0].code;
    const codes = createPremiumCodeBatch({ productId: "product-id", count: 25, existingCodes: [existing] });

    expect(codes).toHaveLength(25);
    expect(codes.some((code) => code.code === existing)).toBe(false);
  });

  it("exports UTF-8 CSV with English unlock URLs and explicit redemption states", () => {
    const product = getSeedContentSnapshot().products[0];
    const fixture = {
      ...product,
      slug: "printed-book",
      premiumCodes: [
        { id: "unused-id", productId: product.id, code: "LL-UNUSED", active: true },
        { id: "disabled-id", productId: product.id, code: "LL-DISABLED", active: false },
        { id: "redeemed-id", productId: product.id, code: "LL-REDEEMED", active: true, redeemedAt: "2026-10-10T12:00:00.000Z" },
        { id: "formula-id", productId: product.id, code: "=HYPERLINK(\"https://bad.example\")", active: true },
      ],
    };

    const csv = exportPremiumCodesToCsv(fixture, new URL("https://print.lamilialomi.test/base"));

    expect(csv.startsWith("\uFEFF\"product_title\",\"product_slug\",\"premium_code\",\"status\"")).toBe(true);
    expect(csv).toContain(`"unused","yes","","https://print.lamilialomi.test/api/unlock/en/printed-book?productId=${product.id}&code=LL-UNUSED"`);
    expect(csv).toContain("\"disabled\",\"no\",\"\",\"\"");
    expect(csv).toContain("\"redeemed\",\"yes\",\"2026-10-10T12:00:00.000Z\"");
    expect(csv.split("\r\n").find((row) => row.includes("LL-REDEEMED"))).toMatch(/,\"\"$/);
    expect(csv).toContain("\"'=HYPERLINK(\"\"https://bad.example\"\")\"");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
