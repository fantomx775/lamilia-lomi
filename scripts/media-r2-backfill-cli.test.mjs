import { describe, expect, it } from "vitest";

import { parseBackfillArgs, parseReconcileProductId } from "./media-r2-backfill-cli.mjs";

const productId = "b13b1c5d-7f5a-48ee-ae9c-864d7fd9f701";

describe("R2 backfill CLI arguments", () => {
  it("normalizes a scoped product UUID before it can become an R2 prefix", () => {
    const { args, values } = parseBackfillArgs([
      "--reconcile-public",
      "--product-id",
      productId.toUpperCase(),
      "--apply",
    ]);

    expect(parseReconcileProductId(args, values)).toBe(productId);
  });

  it("normalizes the equals-form product scope too", () => {
    const { args, values } = parseBackfillArgs([
      "--reconcile-public",
      `--product-id=${productId.toUpperCase()}`,
      "--apply",
    ]);

    expect(parseReconcileProductId(args, values)).toBe(productId);
  });

  it.each([
    ["--product-id", "--apply"],
    ["--product-id", ""],
    ["--product-id="],
    ["--product-id", "not-a-uuid"],
  ])("rejects missing or invalid scoped IDs: %s %s", (...argv) => {
    const { args, values } = parseBackfillArgs(argv);

    expect(() => parseReconcileProductId(args, values)).toThrow("--product-id requires a product UUID.");
  });

  it("leaves product scope unset when the flag is absent", () => {
    const { args, values } = parseBackfillArgs(["--reconcile-public"]);

    expect(parseReconcileProductId(args, values)).toBeUndefined();
  });
});
