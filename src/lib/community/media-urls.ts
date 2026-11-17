export const COMMUNITY_MEDIA_WIDTHS = [480, 960, 2048] as const;
export type CommunityMediaWidth = typeof COMMUNITY_MEDIA_WIDTHS[number];

export function communityArtworkMediaUrl(id: string, width?: CommunityMediaWidth) {
  const path = `/api/community/artworks/${encodeURIComponent(id)}/media`;
  return width ? `${path}?width=${width}` : path;
}

export function communityArtworkMediaSrcSet(id: string) {
  return COMMUNITY_MEDIA_WIDTHS.map((width) => `${communityArtworkMediaUrl(id, width)} ${width}w`).join(", ");
}
