import { ProductImageGallery } from "@/components/product-image-gallery";
import Link from "next/link";
import type { PublicReaderArtwork } from "@/lib/types";
import type { CommunityHeartAccess, CommunityPublicArtwork } from "@/lib/community/types";
import { CommunityAvatar } from "@/components/community/community-avatar";
import { CommunityHeartControl } from "@/components/community/community-heart-control";
import { communityArtworkMediaUrl, communityArtworkMediaSrcSet } from "@/lib/community/media-urls";

export function ReaderArtworkGallery({ artworks, communityArtworks = [], productSlug, communityEnabled = false, heartAccess = "guest" }: { artworks: PublicReaderArtwork[]; communityArtworks?: CommunityPublicArtwork[]; productSlug?: string; communityEnabled?: boolean; heartAccess?: CommunityHeartAccess }) {
  if (!artworks.length && !communityArtworks.length && !communityEnabled) return null;
  const curatedImages = artworks.map((item) => ({ id: item.id, path: item.src, alt: item.description || `Colored by ${item.displayName}`, caption: `Colored by ${item.displayName}`, unoptimized: true }));
  const communityImages = communityArtworks.map((item) => ({
    id: `community-${item.id}`,
    path: communityArtworkMediaUrl(item.id, 480),
    thumbnailSrcSet: communityArtworkMediaSrcSet(item.id, item.imageDimensions),
    detailPath: communityArtworkMediaUrl(item.id, 2048),
    alt: `Colored by @${item.creator.username}`,
    caption: `Colored by @${item.creator.username}`,
    description: item.description,
    captionHref: `/en/club/creators/${encodeURIComponent(item.creator.username)}`,
    captionAvatar: <CommunityAvatar username={item.creator.username} seed={item.creator.avatarSeed} photoSrc={item.creator.photoSrc} className="size-8 text-xs" />,
    thumbnailAction: <CommunityHeartControl artworkId={item.id} likesCount={item.likesCount} likedByMe={item.likedByMe} access={heartAccess} returnTo={`/en/products/${encodeURIComponent(productSlug ?? item.product.slug)}`} compact />,
    unoptimized: true,
  }));
  const images = [...curatedImages, ...communityImages];
  return <section aria-labelledby="reader-artwork-title" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
    <h2 id="reader-artwork-title" className="text-center font-serif text-3xl font-semibold tracking-tight">Colored by Our Readers</h2>
    {images.length ? <div className="mt-7"><ProductImageGallery images={images} layout="reader-artworks" visibleLimit={4} labels={{ openImages: [...artworks.map((item, index) => `Open artwork ${index + 1} by ${item.displayName}`), ...communityArtworks.map((item, index) => `Open community artwork ${index + 1} by @${item.creator.username}`)], previewTitle: "Reader artwork preview", closePreview: "Close preview", previousImage: "Previous artwork", nextImage: "Next artwork", imagePositions: images.map((_, index) => `${index + 1} of ${images.length}`), moreImages: "more", viewAllImages: "View all {count} artworks" }} /></div> : <div data-testid="colored-by-our-readers-empty" className="mt-7 rounded-xl border border-dashed border-[var(--color-border)] bg-white/60 px-5 py-8 text-center"><p className="font-serif text-xl font-semibold text-[var(--color-ink)]">A little inspiration is on its way</p><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Explore approved coloring from the community and see how this book inspires other artists.</p><Link href="/en/club" className="mt-4 inline-flex min-h-10 items-center rounded-md border border-[var(--color-border)] bg-white px-4 text-sm font-semibold hover:bg-[var(--color-blush)]">Explore Coloring Club</Link></div>}
    {productSlug && communityArtworks.length ? <div className="mt-6 text-center"><a data-testid="colored-by-our-readers-view-all" href={`/en/club?productId=${encodeURIComponent(communityArtworks[0].product.id)}`} className="inline-flex min-h-10 items-center rounded-md border border-[var(--color-border)] bg-white px-4 text-sm font-semibold hover:bg-[var(--color-blush)]">See more community coloring</a></div> : null}
  </section>;
}
