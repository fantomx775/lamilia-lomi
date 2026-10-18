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
  return renderToStaticMarkup(
    <ProductInsideBookSection
      title="Inside the book"
      description="A preview of the book."
      images={sectionImages}
      labels={labels}
      video={sectionVideo}
      poster="/images/cover.png"
    />,
  );
}

describe("ProductInsideBookSection media layout", () => {
  it("uses two columns when gallery images and playable video exist", () => {
    const markup = renderSection(images, video);

    expect(markup).toContain('data-layout="gallery-video"');
    expect(markup).toMatch(/class="mt-7 grid gap-6 lg:grid-cols-/);
    expect(markup).toContain('sizes="(min-width: 1280px) 335px, (min-width: 1024px) calc(28.75vw - 33px), (min-width: 640px) calc(50vw - 32px), calc(50vw - 22px)"');
    expect(markup).toContain('aria-label="Open image 1"');
    expect(markup).toContain("<video");
  });

  it("lets images use the full media width when no playable video exists", () => {
    const markup = renderSection(images, {
      ...video,
      contentType: "image/svg+xml",
    });

    expect(markup).toContain('data-layout="gallery"');
    expect(markup).toContain('class="mt-7"');
    expect(markup).not.toContain("lg:grid-cols-");
    expect(markup).not.toContain("<video");
    expect(markup).toContain('sizes="(min-width: 1280px) 600px, (min-width: 1024px) calc(50vw - 40px), (min-width: 640px) calc(50vw - 32px), calc(50vw - 22px)"');
    expect(markup).toContain('aria-label="Open image 1"');
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
