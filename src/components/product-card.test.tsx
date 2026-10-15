/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("next/image", () => ({
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) =>
    createElement("img", { src, alt, className }),
}));
vi.mock("@/components/link-pending-indicator", () => ({
  LinkPendingIndicator: () => null,
}));

import { ProductCard } from "@/components/product-card";
import type { LocalizedProductView } from "@/lib/types";

const longTitle = "A Long Product Title That Needs More Than Three Lines on a Narrow Catalog Card";
const product = {
  id: "product-1",
  slug: "sleepy-garden",
  audienceLabel: "Kids",
  productType: "Activity book",
  title: longTitle,
  shortDescription: "A gentle activity book for little readers.",
  cover: { path: "/cover.png", title: "Cover", id: "cover-1" },
} as LocalizedProductView;

afterEach(cleanup);

describe("ProductCard", () => {
  it("reserves a three-line title area and exposes the full title through a keyboard and touch disclosure", () => {
    render(<ProductCard product={product} locale="en" />);

    const heading = screen.getByRole("heading", { name: longTitle });
    expect(heading).toHaveClass("line-clamp-3", "min-h-[3lh]", "[overflow-wrap:anywhere]");
    expect(heading).toHaveTextContent(longTitle);

    const fullTitleDisclosure = screen.getByText("Read full title");
    expect(fullTitleDisclosure.tagName).toBe("SUMMARY");
    fireEvent.click(fullTitleDisclosure);
    expect(screen.getByTestId("full-product-title")).toHaveTextContent(longTitle);
    expect(fullTitleDisclosure.parentElement).toHaveAttribute("open");

    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/products/sleepy-garden");
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("src", "/cover.png");
  });
});
