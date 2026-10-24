import { ProductImageGallery } from "@/components/product-image-gallery";
import type { PublicReaderArtwork } from "@/lib/types";

export function ReaderArtworkGallery({ artworks }: { artworks: PublicReaderArtwork[] }) {
  if (!artworks.length) return null;
  const images = artworks.map((item) => ({ id: item.id, path: item.src, alt: item.description || `Colored by ${item.displayName}`, caption: `Colored by ${item.displayName}`, unoptimized: true }));
  return <section aria-labelledby="reader-artwork-title" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-2xl text-center"><h2 id="reader-artwork-title" className="font-serif text-3xl font-semibold tracking-tight">Colored by Our Readers</h2><p className="mt-3 text-[var(--color-muted)]">A little inspiration from our creative community.</p></div>
    <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {artworks.map((item, index) => <article key={item.id} className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
        <div className="p-3"><ProductImageGallery images={[images[index]]} labels={{ openImages: [`Open artwork by ${item.displayName}`], previewTitle: "Artwork preview", closePreview: "Close preview", previousImage: "Previous image", nextImage: "Next image", imagePositions: ["1 of 1"] }} /></div>
        <div className="px-4 pb-4"><p className="font-medium">Colored by {item.displayName}</p>{item.description ? <p className="mt-1 text-sm text-[var(--color-muted)]">{item.description}</p> : null}</div>
      </article>)}
    </div>
  </section>;
}
