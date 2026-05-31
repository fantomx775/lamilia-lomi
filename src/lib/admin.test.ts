import { describe, expect, it } from "vitest";

import { exportUsersToCsv, validateProductForPublish } from "./admin";
import { products } from "./seed-data";

describe("admin behavior", () => {
  it("requires English title and Amazon link before publishing", () => {
    expect(validateProductForPublish(products[0])).toMatchObject({ ok: true });
    expect(
      validateProductForPublish({
        translations: [],
        amazonLinks: [],
      }),
    ).toMatchObject({
      ok: false,
      missing: ["English title", "Amazon link"],
    });
  });

  it("exports marketing email CSV without non-consenting users", () => {
    const csv = exportUsersToCsv({ marketingOnly: true });

    expect(csv).toContain("admin@lamilialomi.test");
    expect(csv).not.toContain("unverified@lamilialomi.test");
  });
});
