import type { ProductAsset } from "./types";

export type VideoPreviewAsset = Pick<ProductAsset, "contentType" | "path" | "title">;

/** Shared data validation: callable by Server Components and the native client
 * player without crossing a React client-module boundary. */
export function isPlayableVideoAsset(
  asset: VideoPreviewAsset | null | undefined,
): asset is VideoPreviewAsset {
  return Boolean(
    asset?.path.trim() &&
      asset.contentType.trim().toLowerCase().startsWith("video/"),
  );
}
