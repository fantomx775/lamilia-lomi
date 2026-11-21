import { COMMUNITY_IMAGE_MAX_EDGE, COMMUNITY_IMAGE_MAX_PIXELS } from "./image-limits";
import type { CommunityArtworkDimensions } from "./types";

export const COMMUNITY_MEDIA_WIDTHS = [480, 960, 2048] as const;
export type CommunityMediaWidth = typeof COMMUNITY_MEDIA_WIDTHS[number];

export function communityArtworkMediaUrl(id: string, width?: CommunityMediaWidth) {
  const path = `/api/community/artworks/${encodeURIComponent(id)}/media`;
  return width ? `${path}?width=${width}` : path;
}

export function communityArtworkMediaSrcSet(id: string, dimensions?: CommunityArtworkDimensions | null) {
  const validDimensions = communityArtworkDimensions(dimensions?.width, dimensions?.height);
  if (!validDimensions) return undefined;

  let previousWidth = 0;
  const candidates = COMMUNITY_MEDIA_WIDTHS.flatMap((requestedWidth) => {
    const actualWidth = Math.min(validDimensions.width, requestedWidth);
    if (actualWidth <= previousWidth) return [];
    previousWidth = actualWidth;
    return [`${communityArtworkMediaUrl(id, requestedWidth)} ${actualWidth}w`];
  });
  return candidates.join(", ");
}

export function communityArtworkDimensions(width: unknown, height: unknown): CommunityArtworkDimensions | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null;
  const safeWidth = width as number;
  const safeHeight = height as number;
  if (safeWidth < 1 || safeHeight < 1 || safeWidth > COMMUNITY_IMAGE_MAX_EDGE || safeHeight > COMMUNITY_IMAGE_MAX_EDGE
    || safeWidth * safeHeight > COMMUNITY_IMAGE_MAX_PIXELS) return null;
  return { width: safeWidth, height: safeHeight };
}
