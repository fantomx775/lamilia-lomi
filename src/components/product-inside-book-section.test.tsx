import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ProductInsideBookSection,
} from "@/components/product-inside-book-section";
import { isPlayableVideoAsset } from "@/components/product-video-preview";
import type {
  ProductGalleryImage,
  ProductImageGalleryLabels,
} from "@/components/product-image-gallery";

const images: ProductGalleryImage[] = [
  {
    id: "gallery-image-1",
    path: "/images/page-1.png",
    alt: "A page from the book",
    caption: null,
    unoptimized: false,
  },
];

const labels: ProductImageGalleryLabels = {
  openImages: ["Open image 1"],
  previewTitle: "Image preview",
  closePreview: "Close image preview",
  previousImage: "Previous image",
  nextImage: "Next image",
  imagePositions: ["1 of 1"],
  moreImages: "more",
  viewAllImages: "View all 1 pages",
};

const video = {
  path: "/videos/preview.mp4",
  title: "Book preview",
  contentType: "video/mp4",
};

function renderSection(
  sectionImages: ProductGalleryImage[],
  sectionVideo?: typeof video | null,
) {
  const sectionLabels = {
    ...labels,
    openImages: sectionImages.map((_, index) => `Open image ${index + 1}`),
    imagePositions: sectionImages.map((_, index) => `${index + 1} of ${sectionImages.length}`),
    viewAllImages: `View all ${sectionImages.length} pages`,
  };

  return renderToStaticMarkup(
    <ProductInsideBookSection
      title="Inside the book"
      description="A preview of the book."
      images={sectionImages}
      labels={sectionLabels}
      video={sectionVideo}
      poster="/images/cover.png"
    />,
  );
}

function makeImages(count: number): ProductGalleryImage[] {
  return Array.from({ length: count }, (_, index) => ({
    ...images[0],
    id: `gallery-image-${index + 1}`,
    path: `/images/page-${index + 1}.png`,
    alt: `A page from the book, ${index + 1}`,
  }));
}

describe("ProductInsideBookSection media layout", () => {
  it.each([1, 2, 3, 4])("retains two-column gallery with playable video and %i images", (count) => {
    const markup = renderSection(makeImages(count), video);

    expect(markup).toContain('data-layout="gallery-video"');
    expect(markup).toMatch(/class="mt-7 grid gap-6 lg:grid-cols-/);
    expect(markup).toContain('class="grid grid-cols-2 gap-3 sm:gap-4"');
    expect(markup).not.toContain("lg:grid-cols-4");
    expect(markup).toContain('sizes="(min-width: 1280px) 335px, (min-width: 1024px) calc(28.75vw - 33px), (min-width: 640px) calc(50vw - 32px), calc(50vw - 22px)"');
    expect(markup).toContain('aria-label="Open image 1"');
    expect(markup.match(/aria-label="Open image/g)).toHaveLength(count);
    expect(markup).toContain("<video");
  });

  it.each([1, 2, 3, 4])("uses a two-column mobile and four-column desktop gallery for %i images without video", (count) => {
    const markup = renderSection(makeImages(count));
    expect(markup).toContain('data-layout="gallery"');
    expect(markup).toContain('class="mt-7"');
    expect(markup).toContain('data-layout="gallery" class="mt-7"');
    expect(markup).not.toContain("<video");
    expect(markup).toContain('class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"');
    expect(markup).toContain('sizes="(min-width: 1280px) 300px, (min-width: 1024px) calc(25vw - 28px), (min-width: 640px) calc(50vw - 32px), calc(50vw - 22px)"');
    expect(markup.match(/aria-label="Open image/g)).toHaveLength(count);
    expect(markup).toContain('aria-label="Open image 1"');
  });

  it.each([1, 2, 3, 4])("uses the no-video layout when image %i has a non-playable video asset", (count) => {
    const markup = renderSection(makeImages(count), {
      ...video,
      contentType: "image/svg+xml",
    });

    expect(markup).toContain('data-layout="gallery"');
    expect(markup).toContain('class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"');
    expect(markup).not.toContain("<video");
    expect(markup.match(/aria-label="Open image/g)).toHaveLength(count);
  });

  it("shows video at full width without an empty gallery column", () => {
    const markup = renderSection([], video);

    expect(markup).toContain('data-layout="video"');
    expect(markup).toContain('class="mt-7"');
    expect(markup).not.toContain("lg:grid-cols-");
    expect(markup).not.toContain("Open image");
    expect(markup).toContain("<video");
  });

  it("omits the section when no gallery or playable video exists", () => {
    expect(
      renderSection([], { ...video, contentType: "application/octet-stream" }),
    ).toBe("");
  });
});

describe("isPlayableVideoAsset", () => {
  it("accepts a non-empty path and case-insensitive video content type", () => {
    expect(
      isPlayableVideoAsset({ ...video, contentType: " VIDEO/MP4 " }),
    ).toBe(true);
  });

  it("rejects an empty path or a non-video content type", () => {
    expect(isPlayableVideoAsset({ ...video, path: " " })).toBe(false);
    expect(
      isPlayableVideoAsset({ ...video, contentType: "image/png" }),
    ).toBe(false);
  });
});
