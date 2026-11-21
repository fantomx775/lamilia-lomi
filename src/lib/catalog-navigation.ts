import type { Locale } from "@/i18n/routing";

export function safeCatalogReturn(value: string | undefined, locale: Locale): string {
  const fallback = `/${locale}/products`;
  if (!value || value.length > 4096 || !value.startsWith(`${fallback}`)) return fallback;
  try {
    const url = new URL(value, "https://catalog.invalid");
    if (url.origin !== "https://catalog.invalid" || url.pathname !== fallback) return fallback;
    const query = new URLSearchParams();
    for (const key of ["q", "audience", "type", "category", "tag", "sort"]) {
      const item = url.searchParams.get(key);
      if (item) query.set(key, item.slice(0, 512));
    }
    const hash = /^#catalog-product-[a-zA-Z0-9-]+$/.test(url.hash) ? url.hash : "";
    return `${fallback}${query.size ? `?${query}` : ""}${hash}`;
  } catch { return fallback; }
}

export function catalogGridClass(columns: 3 | 4 | 5) {
  return `mt-5 grid gap-4 sm:grid-cols-2 sm:gap-5 md:mt-8 lg:grid-cols-3 lg:gap-6 ${{ 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5" }[columns]}`;
}
