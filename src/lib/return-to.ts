import { normalizeLocale } from "./locale";

const LOCAL_ORIGIN = "http://lamilialomi.local";

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

    url.searchParams.delete("code");
    url.searchParams.delete("premiumCode");

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
  const match = safe.match(new RegExp(`^/${locale}/products/([^/?]+)$`));

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
