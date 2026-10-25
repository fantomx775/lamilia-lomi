// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("consented GA4", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.resetModules(); localStorage.clear(); document.cookie = "ll_analytics_denied=; Max-Age=0; path=/"; Object.defineProperty(window, "dataLayer", { value: [], writable: true, configurable: true }); });
  it("persists withdrawal even when old consent can be read but storage writes fail", async () => {
    localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: true }));
    const { writeConsent, readConsent } = await import("./analytics-client");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(writeConsent(false)).toBe(true);
    expect(readConsent()?.analytics).toBe(false);
    vi.resetModules(); // Simulate a new document with the old localStorage value still present.
    expect((await import("./analytics-client")).readConsent()?.analytics).toBe(false);
  });
  it("fails closed for missing, malformed and untyped consent", async () => {
    const { readConsent, startAnalytics, trackEvent } = await import("./analytics-client");
    for (const stored of ["null", "broken", '{"essential":true,"analytics":"yes"}', '{"analytics":true}']) {
      localStorage.setItem("ll_cookie_consent", stored);
      expect(readConsent()).toBeNull(); startAnalytics(); trackEvent("form_submit");
    }
    expect((window as unknown as { dataLayer: unknown[] }).dataLayer).toEqual([]);
  });
  it("initializes once, counts routes once, blocks events after withdrawal and clears GA cookies", async () => {
    const { startAnalytics, trackEvent, trackPage, stopAnalytics } = await import("./analytics-client");
    localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: true }));
    startAnalytics(); startAnalytics(); trackPage("/en"); trackPage("/en"); trackPage("/en/products");
    trackEvent("amazon_link_click", { product_id: "book", market: "US" });
    const layer = (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer;
    const commands = layer.map(item => Array.from(item));
    expect(commands.filter(item => item[0] === "config")).toHaveLength(1);
    expect(commands.filter(item => item[1] === "page_view")).toHaveLength(2);
    expect(commands[0]).toEqual(["consent", "default", expect.objectContaining({ analytics_storage: "denied", ad_storage: "denied" })]);
    document.cookie = "_ga=example; path=/";
    document.cookie = "essential=yes; path=/";
    localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false }));
    stopAnalytics(); trackEvent("video_play");
    expect(layer).toHaveLength(0);
    expect(document.cookie).not.toContain("_ga=");
    expect(document.cookie).toContain("essential=yes");
  });
});
