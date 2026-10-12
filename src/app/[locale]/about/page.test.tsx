/** @vitest-environment jsdom */

import { createElement, type ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  getAboutPageSettingsForRequest: vi.fn(),
  getPublishedProductViewsForRequest: vi.fn(),
}));

vi.mock("@/lib/content-repository", () => ({
  getAboutPageSettingsForRequest: pageMocks.getAboutPageSettingsForRequest,
}));

vi.mock("@/lib/products-request", () => ({
  getPublishedProductViewsForRequest: pageMocks.getPublishedProductViewsForRequest,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    createElement("img", { src, alt }),
}));

import AboutPage from "./page";
import type { AboutPageSettings, LocalizedProductView } from "@/lib/types";

afterEach(() => cleanup());

const settings: AboutPageSettings = {
  intro: "Thoughtful books for creative little moments.",
  favoriteColoringBookIds: ["coloring-2", "coloring-1", "unavailable-coloring"],
  favoritePictureBookIds: ["picture-1", "coloring-2", "misfiled-book"],
};

describe("About page", () => {
  beforeEach(() => {
    pageMocks.getAboutPageSettingsForRequest.mockResolvedValue(settings);
    pageMocks.getPublishedProductViewsForRequest.mockResolvedValue([
      makeProduct("picture-1", "The Moonlit Forest", "A gentle bedtime story.", "picture-book"),
      makeProduct("misfiled-book", "A Coloring Book", "It no longer belongs in this section.", "coloring-book"),
      makeProduct("coloring-1", "Garden Patterns", "Flowers and tiny creatures to color.", "coloring-book"),
      makeProduct("coloring-2", "Moon Garden Coloring Book", "A calm coloring escape.", "coloring-book"),
    ]);
  });

  it("keeps configured product order, shows current product details, and skips unavailable or duplicate ids", async () => {
    render(await AboutPage({ params: Promise.resolve({ locale: "en" }) }));

    expect(pageMocks.getAboutPageSettingsForRequest).toHaveBeenCalledOnce();
    expect(pageMocks.getPublishedProductViewsForRequest).toHaveBeenCalledWith("en");
    expect(screen.getByRole("heading", { level: 1, name: "About Lamilia Lomi" })).toBeInTheDocument();
    expect(screen.getByText("Thoughtful books for creative little moments.")).toBeInTheDocument();

    const coloringSection = screen.getByRole("region", { name: "Favorite Coloring Books" });
    const coloringTitles = within(coloringSection).getAllByRole("heading", { level: 3 });
    expect(coloringTitles.map((heading) => heading.textContent)).toEqual([
      "Moon Garden Coloring Book",
      "Garden Patterns",
    ]);
    expect(within(coloringSection).getByText("A calm coloring escape.")).toBeInTheDocument();
    expect(within(coloringSection).getByText("Flowers and tiny creatures to color.")).toBeInTheDocument();
    expect(within(coloringSection).getAllByText((_, element) =>
      element?.tagName === "P" &&
      element.textContent?.replace(/\s+/g, " ").includes("Kids · Coloring Book") === true,
    )).toHaveLength(2);
    expect(within(coloringSection).getByRole("img", { name: "Cover for Moon Garden Coloring Book" })).toBeInTheDocument();
    expect(within(coloringSection).getAllByRole("link", { name: "View on Amazon" })[0]).toHaveAttribute(
      "href",
      "https://www.amazon.com/dp/coloring-2",
    );

    const pictureSection = screen.getByRole("region", { name: "Favorite Picture Books" });
    expect(within(pictureSection).getByRole("heading", { level: 3, name: "The Moonlit Forest" })).toBeInTheDocument();
    expect(within(pictureSection).queryByRole("heading", { level: 3, name: "Moon Garden Coloring Book" })).not.toBeInTheDocument();
    expect(within(pictureSection).queryByRole("heading", { level: 3, name: "A Coloring Book" })).not.toBeInTheDocument();
    expect(within(pictureSection).queryByText("unavailable-coloring")).not.toBeInTheDocument();
    expect(screen.getByText("A little wonder on every page.")).toBeInTheDocument();
  });

  it("uses updated product records and provides an empty state when no configured product is public", async () => {
    const first = await AboutPage({ params: Promise.resolve({ locale: "en" }) });
    const view = render(first);
    expect(screen.getByRole("heading", { level: 3, name: "Moon Garden Coloring Book" })).toBeInTheDocument();

    pageMocks.getAboutPageSettingsForRequest.mockResolvedValue({
      ...settings,
      favoriteColoringBookIds: ["coloring-2", "", ""],
      favoritePictureBookIds: ["unpublished-picture", "", ""],
    });
    pageMocks.getPublishedProductViewsForRequest.mockResolvedValue([
      makeProduct(
        "coloring-2",
        "Moon Garden, Reimagined",
        "A refreshed description from the latest product record.",
        "coloring-book",
        "https://www.amazon.com/dp/coloring-2-updated",
      ),
    ]);

    view.rerender(await AboutPage({ params: Promise.resolve({ locale: "en" }) }));

    expect(screen.getByRole("heading", { level: 3, name: "Moon Garden, Reimagined" })).toBeInTheDocument();
    expect(screen.getByText("A refreshed description from the latest product record.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on Amazon" })).toHaveAttribute(
      "href",
      "https://www.amazon.com/dp/coloring-2-updated",
    );
    expect(screen.getByText("New favorites are on the way.")).toBeInTheDocument();
  });
});

function makeProduct(
  id: string,
  title: string,
  shortDescription: string,
  productType: string,
  amazonUrl = `https://www.amazon.com/dp/${id}`,
): LocalizedProductView {
  const primaryAmazonLink = {
    id: `${id}-amazon`,
    productId: id,
    market: "amazon.com" as const,
    url: amazonUrl,
    isPrimary: true,
  };

  return {
    id,
    slug: id,
    status: "published",
    audience: "kids",
    audienceLabel: "Kids",
    productType,
    title,
    shortDescription,
    longDescription: "",
    seoTitle: title,
    seoDescription: shortDescription,
    cover: {
      id: `${id}-cover`,
      productId: id,
      kind: "cover",
      bucket: "public-media",
      path: `/covers/${id}.svg`,
      filename: `${id}.svg`,
      contentType: "image/svg+xml",
      title: `Cover for ${title}`,
      sortOrder: 0,
      isPublic: true,
    },
    gallery: [],
    publicDownloads: [],
    premiumAssets: [],
    categories: [],
    tags: [],
    amazonLinks: [primaryAmazonLink],
    primaryAmazonLink,
    reviewDelayDays: 0,
  };
}
