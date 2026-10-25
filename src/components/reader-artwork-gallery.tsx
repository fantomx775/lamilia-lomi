import { ProductImageGallery } from "@/components/product-image-gallery";
import type { PublicReaderArtwork } from "@/lib/types";

export function ReaderArtworkGallery({ artworks }: { artworks: PublicReaderArtwork[] }) {
  if (!artworks.length) return null;
  const images = artworks.map((item) => ({ id: item.id, path: item.src, alt: item.description || `Colored by ${item.displayName}`, caption: `Colored by ${item.displayName}`, unoptimized: true }));
  return <section aria-labelledby="reader-artwork-title" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-2xl text-center"><h2 id="reader-artwork-title" className="font-serif text-3xl font-semibold tracking-tight">Colored by Our Readers</h2><p className="mt-3 text-[var(--color-muted)]">A little inspiration from our creative community.</p></div>
    <div className="mt-7"><ProductImageGallery images={images} layout="reader-artworks" visibleLimit={4} labels={{ openImages: artworks.map((item, index) => `Open artwork ${index + 1} by ${item.displayName}`), previewTitle: "Reader artwork preview", closePreview: "Close preview", previousImage: "Previous artwork", nextImage: "Next artwork", imagePositions: artworks.map((_, index) => `${index + 1} of ${artworks.length}`), moreImages: "more", viewAllImages: "View all {count} artworks" }} /></div>
  </section>;
}
