/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ src, alt, onError, className, unoptimized }: {
    src: string;
    alt: string;
    onError?: () => void;
    className?: string;
    unoptimized?: boolean;
  }) => createElement("img", { src, alt, onError, className, "data-unoptimized": unoptimized }),
}));

import { CategoryTileImage } from "@/components/category-tile-image";

afterEach(cleanup);

describe("CategoryTileImage", () => {
  it("uses an intentional decorative fallback when a category has no image", () => {
    render(<CategoryTileImage />);

    expect(screen.getByTestId("category-image-fallback")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps a configured image and falls back if that image fails to load", () => {
    render(<CategoryTileImage src="/category-cover.png" />);

    const image = document.querySelector("img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", "/category-cover.png");
    fireEvent.error(image!);

    expect(screen.getByTestId("category-image-fallback")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("optimizes UUID-versioned category media paths", () => {
    render(
      <CategoryTileImage
        src="/api/category-media/11111111-1111-4111-8111-111111111111?v=22222222-2222-4222-8222-222222222222"
      />,
    );

    expect(document.querySelector("img")).toHaveAttribute("data-unoptimized", "false");
  });

  it("keeps legacy category proxy paths unoptimized", () => {
    render(<CategoryTileImage src="/api/category-media/11111111-1111-4111-8111-111111111111" />);

    expect(document.querySelector("img")).toHaveAttribute("data-unoptimized", "true");
  });
});
