/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(() => cleanup());

describe("ProductCard", () => {
  it("always exposes the complete title without a separate disclosure", () => {
    render(<ProductCard product={product} locale="en" />);
    const heading = screen.getByRole("heading", { name: longTitle });
    expect(heading).toHaveTextContent(longTitle);
    expect(heading).not.toHaveClass("line-clamp-3");
    expect(heading).toHaveClass("break-words", "[overflow-wrap:anywhere]");
    expect(screen.queryByText("Read full title")).toBeNull();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/products/sleepy-garden");
    const link = screen.getByRole("link");
    expect(link).toHaveClass("focus-visible:outline-2");
    expect(link).toHaveAccessibleName(expect.stringContaining(longTitle));
    expect(link.closest("article")).not.toHaveClass("focus-within:ring-2");
    expect(heading).toHaveAttribute("aria-label", longTitle);
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("src", "/cover.png");
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("alt", "Cover");
  });
  it("carries a validated result URL and card anchor to the product", () => {
    render(<ProductCard product={product} locale="en" catalogHref="/en/products?q=garden&audience=kids&sort=az" />);
    const href = new URL(screen.getByRole("link").getAttribute("href")!, "https://example.test");
    expect(href.pathname).toBe("/en/products/sleepy-garden");
    expect(href.searchParams.get("catalog")).toBe("/en/products?q=garden&audience=kids&sort=az#catalog-product-product-1");
    expect(screen.getByRole("link").closest("article")).toHaveAttribute("id", "catalog-product-product-1");
  });

});
