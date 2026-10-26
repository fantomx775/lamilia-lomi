import type { MetadataRoute } from "next";

import { getCanonicalAppUrl } from "@/lib/config";
import { getPublishedProductViewsForRequest } from "@/lib/products-request";
import { routing } from "@/i18n/routing";
import { getCommunityFlags } from "@/lib/community-flags";
import { listCommunityPublicArtworks } from "@/lib/community/repository";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const appUrl = getCanonicalAppUrl().origin;
  const staticRoutes = ["", "/products", "/privacy", "/terms", "/contact", "/author"];
  const localeRoutes = (
    await Promise.all(
      routing.locales.map(async (locale) => [
        ...staticRoutes.map((route) => ({
          url: `${appUrl}/${locale}${route}`,
          lastModified: new Date("2026-05-31"),
        })),
        ...(await getPublishedProductViewsForRequest(locale)).map((product) => ({
          url: `${appUrl}/${locale}/products/${product.slug}`,
          lastModified: new Date("2026-05-31"),
        })),
      ]),
    )
  ).flat();

  const communityRoutes: MetadataRoute.Sitemap = [];
  if (getCommunityFlags().publicEnabled && routing.locales.includes("en")) {
    communityRoutes.push({ url: `${appUrl}/en/club`, lastModified: new Date("2026-10-26") });
    const creatorUsernames = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const result = await listCommunityPublicArtworks({ limit: 100, cursor });
      communityRoutes.push(...result.items.map((artwork) => ({
        url: `${appUrl}/en/club/artworks/${artwork.id}`,
        lastModified: new Date(artwork.publishedAt),
      })));
      for (const artwork of result.items) creatorUsernames.add(artwork.creator.username);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    communityRoutes.push(...[...creatorUsernames].map((username) => ({
      url: `${appUrl}/en/club/creators/${encodeURIComponent(username)}`,
      lastModified: new Date("2026-10-26"),
    })));
  }

  return [
    {
      url: appUrl,
      lastModified: new Date("2026-05-31"),
    },
    ...localeRoutes,
    ...communityRoutes,
  ];
}
