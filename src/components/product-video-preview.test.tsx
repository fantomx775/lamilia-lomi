import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductVideoPreview } from "@/components/product-video-preview";

describe("ProductVideoPreview", () => {
  it("does not cover an uploaded video with the fallback label", () => {
    const markup = renderToStaticMarkup(
      <ProductVideoPreview
        video={{
          path: "/api/media/asset-video",
          title: "Flipthrough preview",
          contentType: "video/mp4",
        }}
      />,
    );

    expect(markup).toContain("<video");
    expect(markup).toContain('aria-label="Flipthrough preview"');
    expect(markup).not.toContain("Public flipthrough video");
  });

  it("shows the fallback label instead of treating a placeholder image as a video", () => {
    const markup = renderToStaticMarkup(
      <ProductVideoPreview
        video={{
          path: "/assets/video/flipthrough-placeholder.svg",
          title: "Flipthrough preview",
          contentType: "image/svg+xml",
        }}
      />,
    );

    expect(markup).not.toContain("<video");
    expect(markup).toContain("Public flipthrough video");
  });
});
