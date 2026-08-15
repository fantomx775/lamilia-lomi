import { describe, expect, it } from "vitest";

import { getHistoryTarget, type RouteHistory } from "@/components/admin-page-transition";

describe("getHistoryTarget", () => {
  it("chooses the correct duplicate pathname entry for Back and Forward", () => {
    const history: RouteHistory = {
      paths: ["/admin/products", "/admin/categories", "/admin/products"],
      index: 1,
    };

    expect(getHistoryTarget(history, "/admin/products")).toEqual({
      index: 2,
      direction: "forward",
    });
    expect(getHistoryTarget({ ...history, index: 2 }, "/admin/products", 0)).toEqual({
      index: 0,
      direction: "back",
    });
  });
});
