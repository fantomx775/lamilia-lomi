/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }

  observe() {}
  disconnect() {}

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  TestResizeObserver.instances = [];
});

function setTitleMeasurements(heading: HTMLElement, clientHeight: number, scrollHeight: number) {
  Object.defineProperties(heading, {
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollHeight: { configurable: true, get: () => scrollHeight },
  });
}

function triggerResize() {
  act(() => TestResizeObserver.instances.at(-1)?.trigger());
}

describe("ProductCard", () => {
  it("keeps short titles free of a disclosure and updates when the card width changes", () => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const shortProduct = { ...product, title: "Moon Garden" } as LocalizedProductView;

    render(<ProductCard product={shortProduct} locale="en" />);

    const heading = screen.getByRole("heading", { name: "Moon Garden" });
    expect(heading).toHaveClass("line-clamp-3", "min-h-[3lh]", "[overflow-wrap:anywhere]");
    setTitleMeasurements(heading, 60, 60);
    triggerResize();
    expect(screen.queryByText("Read full title")).not.toBeInTheDocument();

    setTitleMeasurements(heading, 60, 80);
    triggerResize();
    expect(screen.getByText("Read full title")).toBeInTheDocument();

    setTitleMeasurements(heading, 60, 60);
    triggerResize();
    expect(screen.queryByText("Read full title")).not.toBeInTheDocument();
  });

  it("reserves a three-line title area and exposes a truncated full title through a keyboard and touch disclosure", () => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    render(<ProductCard product={product} locale="en" />);

    const heading = screen.getByRole("heading", { name: longTitle });
    const productLink = screen.getByRole("link");
    const card = productLink.closest("article");
    expect(heading).toHaveClass("line-clamp-3", "min-h-[3lh]", "[overflow-wrap:anywhere]");
    expect(card).not.toHaveClass("focus-within:ring-2");
    expect(productLink).toHaveClass("focus-visible:outline-2");
    expect(heading).toHaveTextContent(longTitle);
    expect(heading).toHaveAttribute("aria-label", longTitle);

    setTitleMeasurements(heading, 60, 80);
    triggerResize();

    const fullTitleDisclosure = screen.getByText("Read full title");
    expect(fullTitleDisclosure.tagName).toBe("SUMMARY");
    expect(fullTitleDisclosure).toHaveClass("focus-visible:outline-2");
    fireEvent.click(fullTitleDisclosure);
    expect(screen.getByTestId("full-product-title")).toHaveTextContent(longTitle);
    expect(fullTitleDisclosure.parentElement).toHaveAttribute("open");

    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/products/sleepy-garden");
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("src", "/cover.png");
  });
});
