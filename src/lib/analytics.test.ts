import { describe, expect, it } from "vitest";

import { businessEvents, shouldLoadGa4 } from "./analytics";

describe("analytics consent", () => {
  it("loads GA4 only after analytics consent", () => {
    expect(shouldLoadGa4(null, "G-123")).toBe(false);
    expect(shouldLoadGa4({ essential: true, analytics: false }, "G-123")).toBe(false);
    expect(shouldLoadGa4({ essential: true, analytics: true }, "G-123")).toBe(true);
  });

  it("keeps required business event names stable", () => {
    expect(businessEvents).toContain("unlock_success");
    expect(businessEvents).toContain("premium_file_download");
    expect(businessEvents).toContain("amazon_link_click");
  });
});
