/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ src, alt, unoptimized, onError }: { src: string; alt: string; unoptimized: boolean; onError: () => void }) =>
    createElement("img", { src, alt, onError, "data-unoptimized": String(unoptimized) }),
}));
import { ImageWithFallback } from "./image-with-fallback";

afterEach(cleanup);
const id = "11111111-1111-4111-8111-111111111111";

describe("versioned media fallback image", () => {
  it.each(["media", "category-media"])("optimizes current versioned %s and preserves direct legacy delivery", (route) => {
    const { rerender } = render(<ImageWithFallback src={`/api/${route}/${id}?v=${id}`} alt="Book" />);
    expect(screen.getByAltText("Book")).toHaveAttribute("data-unoptimized", "false");
    rerender(<ImageWithFallback src={`/api/${route}/${id}`} alt="Book" />);
    expect(screen.getByAltText("Book")).toHaveAttribute("data-unoptimized", "true");
  });

  it("shows a failed image fallback and recovers when a replacement has a new version", () => {
    const replacement = "22222222-2222-4222-8222-222222222222";
    const { rerender } = render(<ImageWithFallback src={`/api/category-media/${id}?v=${id}`} alt="Book" />);
    fireEvent.error(screen.getByAltText("Book"));
    expect(screen.getByRole("img", { name: "Book — brak obrazu" })).toBeVisible();
    rerender(<ImageWithFallback src={`/api/category-media/${id}?v=${replacement}`} alt="Book" />);
    expect(screen.getByAltText("Book")).toHaveAttribute("src", `/api/category-media/${id}?v=${replacement}`);
  });
});
