import { normalizeLocale } from "./locale";

const LOCAL_ORIGIN = "http://lamilialomi.local";
const sensitiveQueryKeys = [
  "code",
  "premiumCode",
  "token",
  "token_hash",
  "access_token",
  "refresh_token",
];

export function sanitizeReturnTo(
  value: string | null | undefined,
  localeInput: string | undefined,
  fallback?: string,
) {
  const locale = normalizeLocale(localeInput);
  const safeFallback = fallback ?? `/${locale}/library`;
  const raw = value?.trim();

  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return safeFallback;
  }

  try {
    const url = new URL(raw, LOCAL_ORIGIN);

    if (url.origin !== LOCAL_ORIGIN) {
      return safeFallback;
    }

    const isLocalePath =
      url.pathname === `/${locale}` || url.pathname.startsWith(`/${locale}/`);
    const isAdminPath =
      url.pathname === "/admin" || url.pathname.startsWith("/admin/");

    if (!isLocalePath && !isAdminPath) {
      return safeFallback;
    }

    for (const key of sensitiveQueryKeys) {
      url.searchParams.delete(key);
    }

    for (const key of ["returnTo", "redirectTo"]) {
      const nested = url.searchParams.get(key);

      if (nested === null) {
        continue;
      }

      const safeNested = sanitizeReturnTo(nested, locale, "");

      if (!safeNested) {
        return safeFallback;
      }

      url.searchParams.set(key, safeNested);
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return safeFallback;
  }
}

export function productSlugFromReturnTo(
  value: string | null | undefined,
  localeInput: string | undefined,
) {
  const locale = normalizeLocale(localeInput);
  const safe = sanitizeReturnTo(value, locale);
  const pathname = new URL(safe, LOCAL_ORIGIN).pathname;
  const match = pathname.match(new RegExp(`^/${locale}/products/([^/?]+)$`));

  if (!match?.[1]) {
    return undefined;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export function isProductReturnTo(
  value: string | null | undefined,
  localeInput: string | undefined,
) {
  return Boolean(productSlugFromReturnTo(value, localeInput));
}

export function switchLocalePath(
  value: string | null | undefined,
  fromLocaleInput: string | undefined,
  targetLocaleInput: string | undefined,
) {
  const fromLocale = normalizeLocale(fromLocaleInput);
  const targetLocale = normalizeLocale(targetLocaleInput);
  const safe = sanitizeReturnTo(value, fromLocale, `/${fromLocale}/library`);
  const url = new URL(safe, LOCAL_ORIGIN);

  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    return `${url.pathname}${url.search}`;
  }

  const sourcePrefix = `/${fromLocale}`;

  if (url.pathname !== sourcePrefix && !url.pathname.startsWith(`${sourcePrefix}/`)) {
    return `/${targetLocale}/library`;
  }

  return `/${targetLocale}${url.pathname.slice(sourcePrefix.length)}${url.search}`;
}
