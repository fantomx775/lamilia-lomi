import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductVideoPreview } from "@/components/product-video-preview";

describe("ProductVideoPreview", () => {
  it("shows the product cover as a native poster and keeps the video controls", () => {
    const markup = renderToStaticMarkup(
      <ProductVideoPreview
        video={{
          path: "/api/media/asset-video",
          title: "Flipthrough preview",
          contentType: "video/mp4",
        }}
        poster="/api/media/product-cover"
      />,
    );

    expect(markup).toContain("<video");
    expect(markup).toContain('poster="/api/media/product-cover"');
    expect(markup).toContain('controls=""');
    expect(markup).toContain('preload="none"');
    expect(markup).toContain('playsInline=""');
    expect(markup).toContain('aria-label="Flipthrough preview"');
    expect(markup).not.toContain("Flip-through · 8 sec");
    expect(markup).not.toContain("Public flipthrough video");
  });

  it("does not render an empty player for a non-video placeholder asset", () => {
    const markup = renderToStaticMarkup(
      <ProductVideoPreview
        video={{
          path: "/assets/video/flipthrough-placeholder.svg",
          title: "Flipthrough preview",
          contentType: "image/svg+xml",
        }}
        poster="/assets/covers/cover-placeholder.svg"
      />,
    );

    expect(markup).not.toContain("<video");
    expect(markup).toBe("");
    expect(markup).not.toContain("Public flipthrough video");
  });
});
