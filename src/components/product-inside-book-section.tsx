import type { ProductAsset } from "@/lib/types";

import {
  ProductImageGallery,
  type ProductGalleryImage,
  type ProductImageGalleryLabels,
} from "@/components/product-image-gallery";
import {
  isPlayableVideoAsset,
  ProductVideoPreview,
} from "@/components/product-video-preview";

type ProductVideoAsset = Pick<ProductAsset, "contentType" | "path" | "title">;

type ProductInsideBookSectionProps = {
  title: string;
  description: string;
  images: ProductGalleryImage[];
  labels: ProductImageGalleryLabels;
  video?: ProductVideoAsset | null;
  poster: string;
};

export function ProductInsideBookSection({
  title,
  description,
  images,
  labels,
  video,
  poster,
}: ProductInsideBookSectionProps) {
  const hasGallery = images.length > 0;
  const playableVideo = isPlayableVideoAsset(video) ? video : null;

  if (!hasGallery && !playableVideo) {
    return null;
  }

  const hasGalleryAndVideo = hasGallery && Boolean(playableVideo);

  return (
    <section
      aria-labelledby="inside-book-title"
      className="border-y border-[var(--color-border)] bg-white/50"
    >
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="inside-book-title"
            className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            {title}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-[var(--color-muted)]">
            {description}
          </p>
        </div>

        <div
          data-testid="product-media-layout"
          data-layout={hasGalleryAndVideo ? "gallery-video" : hasGallery ? "gallery" : "video"}
          className={
            hasGalleryAndVideo
              ? "mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start"
              : "mt-7"
          }
        >
          {hasGallery ? <ProductImageGallery images={images} labels={labels} /> : null}
          {playableVideo ? (
            <ProductVideoPreview video={playableVideo} poster={poster} />
          ) : null}
        </div>
      </div>
    </section>
  );
}
