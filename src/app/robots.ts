import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

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
