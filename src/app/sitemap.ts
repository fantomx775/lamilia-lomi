import type { MetadataRoute } from "next";

import { getPublishedProductViews } from "@/lib/products";

export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const staticRoutes = ["", "/products", "/privacy", "/terms", "/contact", "/author"];
  const localeRoutes = ["en", "pl"].flatMap((locale) => [
    ...staticRoutes.map((route) => ({
      url: `${appUrl}/${locale}${route}`,
      lastModified: new Date("2026-05-31"),
    })),
    ...getPublishedProductViews(locale as "en" | "pl").map((product) => ({
      url: `${appUrl}/${locale}/products/${product.slug}`,
      lastModified: new Date("2026-05-31"),
    })),
  ]);

  return [
    {
      url: appUrl,
      lastModified: new Date("2026-05-31"),
    },
    ...localeRoutes,
  ];
}
