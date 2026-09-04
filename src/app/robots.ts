import type { MetadataRoute } from "next";

import { getCanonicalAppUrl } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  const appUrl = getCanonicalAppUrl().origin;

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/en", "/pl", "/en/products", "/pl/products"],
        disallow: ["/admin", "/api", "/en/account", "/pl/account", "/en/library", "/pl/library"],
      },
    ],
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
