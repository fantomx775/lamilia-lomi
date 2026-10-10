import type { MetadataRoute } from "next";

import { getCanonicalAppUrl } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  const appUrl = getCanonicalAppUrl().origin;

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/en", "/en/products"],
        disallow: ["/admin", "/api", "/en/account", "/en/library"],
      },
    ],
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
