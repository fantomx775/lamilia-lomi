import "server-only";

import { dangerouslyDeleteBySrcImage } from "@vercel/functions";
import { getR2PublicBaseUrl, r2PublicMediaUrl } from "./media-r2-config";

function getPurgeConfig() {
  const cloudflareToken = process.env.PRODUCT_IMAGE_CLOUDFLARE_PURGE_TOKEN?.trim();
  const zoneId = process.env.PRODUCT_IMAGE_CLOUDFLARE_ZONE_ID?.trim();
  if (process.env.VERCEL !== "1" || !cloudflareToken || !zoneId) return null;

  return { cloudflareToken, zoneId };
}

export function hasProductImageCachePurge() {
  return getPurgeConfig() !== null;
}

export function versionedProductImagePath(assetId: string) {
  return `/api/media/${assetId}?v=${encodeURIComponent(assetId)}`;
}

export async function purgeProductImageCache(assetId: string, deletedStoragePath?: string) {
  const config = getPurgeConfig();
  if (!config) return;

  const srcImages = [versionedProductImagePath(assetId)];
  if (deletedStoragePath) {
    const sourceUrl = r2PublicMediaUrl(getR2PublicBaseUrl() ?? "", deletedStoragePath);
    if (!sourceUrl) throw new Error("Cannot purge an invalid public product image URL.");
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.zoneId)}/purge_cache`;
    const response = await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.cloudflareToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files: [sourceUrl] }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || (await response.json()).success !== true) {
      throw new Error(`Cloudflare product image cache purge failed (HTTP ${response.status}).`);
    }
    // Older product pages used the direct R2 URL as the optimizer source.
    srcImages.push(sourceUrl);
  }

  await dangerouslyDeleteBySrcImage(srcImages);
}
