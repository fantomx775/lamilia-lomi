import type { MetadataRoute } from "next";

import { getCanonicalAppUrl } from "@/lib/config";
import { getPublishedProductViewsForRequest } from "@/lib/products-request";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const appUrl = getCanonicalAppUrl().origin;
  const staticRoutes = ["", "/products", "/privacy", "/terms", "/contact", "/author"];
  const localeRoutes = (
    await Promise.all(
      ["en", "pl"].map(async (locale) => [
        ...staticRoutes.map((route) => ({
          url: `${appUrl}/${locale}${route}`,
          lastModified: new Date("2026-05-31"),
        })),
        ...(await getPublishedProductViewsForRequest(locale as "en" | "pl")).map((product) => ({
          url: `${appUrl}/${locale}/products/${product.slug}`,
          lastModified: new Date("2026-05-31"),
        })),
      ]),
    )
  ).flat();

  return [
    {
      url: appUrl,
      lastModified: new Date("2026-05-31"),
    },
    ...localeRoutes,
  ];
}
