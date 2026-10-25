// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("consented GA4", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    localStorage.clear();
    Object.defineProperty(document, "referrer", { configurable: true, value: "" });
    document.cookie = "ll_analytics_denied=; Max-Age=0; path=/";
    Object.defineProperty(window, "dataLayer", { value: [], writable: true, configurable: true });
    window.history.replaceState(null, "", "/");
  });

  it("persists withdrawal and blocks events when storage writes fail", async () => {
    localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: true }));
    const { writeConsent, readConsent, startAnalytics, trackPage, trackEvent, stopAnalytics } = await import("./analytics-client");
    startAnalytics();
    trackPage("/");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(writeConsent(false)).toBe(true);
    stopAnalytics();
    trackEvent("form_submit");
    expect((window as unknown as { dataLayer: unknown[] }).dataLayer).toEqual([]);
    expect(readConsent()?.analytics).toBe(false);
    vi.resetModules(); // Simulate a new document with the old localStorage value still present.
    expect((await import("./analytics-client")).readConsent()?.analytics).toBe(false);
  });

  it("fails closed for missing, malformed and untyped consent", async () => {
    const { readConsent, startAnalytics, trackEvent } = await import("./analytics-client");
    for (const stored of ["null", "broken", '{"essential":true,"analytics":"yes"}', '{"analytics":true}']) {
      localStorage.setItem("ll_cookie_consent", stored);
      expect(readConsent()).toBeNull();
      startAnalytics();
      trackEvent("form_submit");
    }
    expect((window as unknown as { dataLayer: unknown[] }).dataLayer).toEqual([]);
  });

  it("tracks sanitized SPA referrers once per pathname and keeps later events on the current page", async () => {
    Object.defineProperty(document, "referrer", { configurable: true, value: "https://source.example/landing?email=private#secret" });
    const { startAnalytics, trackEvent, trackPage } = await import("./analytics-client");
    localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: true }));
    window.history.replaceState(null, "", "/en?campaign=private#secret");
    startAnalytics();
    startAnalytics();

    trackPage("/en");
    trackPage("/en");
    window.history.pushState(null, "", "/en/products?email=private#secret");
    trackPage("/en/products");
    trackPage("/en/products");
    trackEvent("amazon_link_click", { product_id: "book", market: "US" });

    const layer = (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer;
    const commands = layer.map(item => Array.from(item));
    const configIndex = commands.findIndex(item => item[0] === "config");
    const config = commands[configIndex];
    expect(config).toBeDefined();
    expect(config?.[2]).not.toHaveProperty("page_location");
    expect(config?.[2]).not.toHaveProperty("page_referrer");
    expect(commands[configIndex - 1]).toEqual(["set", expect.objectContaining({
      page_location: `${location.origin}/en`,
      page_referrer: "https://source.example",
    })]);

    const pageViews = commands.filter(item => item[0] === "event" && item[1] === "page_view").map(item => item[2] as Record<string, unknown>);
    expect(pageViews).toHaveLength(2);
    expect(pageViews[0]).toMatchObject({ page_location: `${location.origin}/en`, page_path: "/en", page_referrer: "https://source.example" });
    expect(pageViews[1]).toMatchObject({ page_location: `${location.origin}/en/products`, page_path: "/en/products", page_referrer: `${location.origin}/en` });
    expect(JSON.stringify(pageViews)).not.toMatch(/private|secret/);

    const amazonEvent = commands.find(item => item[0] === "event" && item[1] === "amazon_link_click");
    expect(amazonEvent?.[2]).toMatchObject({ page_location: `${location.origin}/en/products`, page_referrer: `${location.origin}/en` });
  });

  it("initializes once, blocks events after withdrawal and clears GA cookies", async () => {
    const { startAnalytics, trackPage, trackEvent, stopAnalytics } = await import("./analytics-client");
    localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: true }));
    startAnalytics();
    window.history.replaceState(null, "", "/en");
    trackPage("/en");
    window.history.replaceState(null, "", "/en/products");
    trackPage("/en/products");
    trackEvent("amazon_link_click", { product_id: "book", market: "US" });
    const layer = (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer;
    const commands = layer.map(item => Array.from(item));
    expect(commands.filter(item => item[0] === "config")).toHaveLength(1);
    expect(commands.filter(item => item[1] === "page_view")).toHaveLength(2);
    expect(commands[0]).toEqual(["consent", "default", expect.objectContaining({ analytics_storage: "denied", ad_storage: "denied" })]);
    document.cookie = "_ga=example; path=/";
    document.cookie = "essential=yes; path=/";
    localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false }));
    stopAnalytics();
    trackEvent("video_play");
    expect(layer).toHaveLength(0);
    expect(document.cookie).not.toContain("_ga=");
    expect(document.cookie).toContain("essential=yes");
  });
});
