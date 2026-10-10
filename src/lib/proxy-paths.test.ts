import { describe, expect, it } from "vitest";

import {
  getEnglishOnlyRedirectUrl,
  isUnlocalizedAuthPath,
  shouldBypassLocaleRouting,
} from "./proxy-paths";

describe("proxy paths", () => {
  it("keeps the Supabase callback on its unlocalized route", () => {
    expect(isUnlocalizedAuthPath("/auth/callback")).toBe(true);
    expect(shouldBypassLocaleRouting("/auth/callback")).toBe(true);
    expect(shouldBypassLocaleRouting("/en/auth/callback")).toBe(false);
  });

  it.each(["/robots.txt", "/sitemap.xml"])("keeps public metadata route %s unlocalized", (pathname) => {
    expect(shouldBypassLocaleRouting(pathname)).toBe(true);
  });

  it.each(["pl", "de", "es"])("redirects legacy /%s URLs to English", (locale) => {
    const redirect = getEnglishOnlyRedirectUrl(
      new URL(`https://lamilialomi.test/${locale}/products?sort=recent`),
    );

    expect(redirect?.pathname).toBe("/en/products");
    expect(redirect?.searchParams.get("sort")).toBe("recent");
  });

  it("rewrites locale-prefixed auth return targets without dropping other query state", () => {
    const redirect = getEnglishOnlyRedirectUrl(
      new URL(
        "https://lamilialomi.test/pl/login?campaign=spring&returnTo=%2Fde%2Fproducts%2Fmoon-garden%3Fstep%3Dverify",
      ),
    );

    expect(redirect?.pathname).toBe("/en/login");
    expect(redirect?.searchParams.get("campaign")).toBe("spring");
    expect(redirect?.searchParams.get("returnTo")).toBe(
      "/en/products/moon-garden?step=verify",
    );
  });

  it("rewrites legacy nested auth return targets from English login pages", () => {
    const redirect = getEnglishOnlyRedirectUrl(
      new URL(
        "https://lamilialomi.test/en/login?returnTo=%2Fpl%2Faccount&redirectTo=%2Fes%2Fproducts",
      ),
    );

    expect(redirect?.pathname).toBe("/en/login");
    expect(redirect?.searchParams.get("returnTo")).toBe("/en/account");
    expect(redirect?.searchParams.get("redirectTo")).toBe("/en/products");
  });

  it("canonicalizes legacy QR unlock URLs and leaves English or unrelated paths alone", () => {
    const legacyUnlock = getEnglishOnlyRedirectUrl(
      new URL("https://lamilialomi.test/api/unlock/es/moon-garden?code=demo"),
    );

    expect(legacyUnlock?.pathname).toBe("/api/unlock/en/moon-garden");
    expect(legacyUnlock?.searchParams.get("code")).toBe("demo");
    expect(getEnglishOnlyRedirectUrl(new URL("https://lamilialomi.test/en/products"))).toBeNull();
    expect(getEnglishOnlyRedirectUrl(new URL("https://lamilialomi.test/plausible"))).toBeNull();
  });
});
