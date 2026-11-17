/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes, ReactNode } from "react";
vi.mock("next/link", () => ({ default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>, useLinkStatus: () => ({ pending: false }) }));
vi.mock("next/form", () => ({ default: ({ children, scroll, ...props }: { children: ReactNode; scroll?: boolean }) => { void scroll; return <form {...props}>{children}</form>; } }));
vi.mock("@/components/category-tile-image", () => ({ CategoryTileImage: () => <span /> }));
import { getSeedContentSnapshot } from "@/lib/local-content";
import { ProductCatalogShell } from "./product-catalog-shell";
import { ProductCatalogLoading } from "./product-catalog-loading";
afterEach(() => cleanup());

describe("real catalog shell across result loading", () => {
  for (const categoryCount of [0, 1, 7]) for (const desktopColumns of [3, 4, 5] as const) {
    it(`${categoryCount} categories / ${desktopColumns} columns retains actual controls and category presence`, () => {
      const snapshot = getSeedContentSnapshot();
      snapshot.catalogSettings.desktopColumns = desktopColumns;
      snapshot.categories = Array.from({ length: categoryCount }, (_, index) => ({ id: `category-${index}`, slug: `category-${index}`, sortOrder: index, translations: [{ locale: "en", name: `Category ${index + 1}` }] }));
      const props = { snapshot, locale: "en" as const, rawSearchParams: { q: "book", audience: "adults", sort: "az" } };
      const view = render(<ProductCatalogShell {...props}><ProductCatalogLoading resultsOnly desktopColumns={desktopColumns} /></ProductCatalogShell>);
      const categories = view.container.querySelector('[aria-label="Categories"]');
      expect(Boolean(categories)).toBe(categoryCount > 0);
      if (categories) expect(categories.querySelectorAll('a[data-testid^="catalog-category-"]:not([data-testid="catalog-category-all"])')).toHaveLength(categoryCount);
      const heading = screen.getByTestId("catalog-heading").outerHTML;
      const controls = [...view.container.querySelectorAll("form,details")].map((node) => node.outerHTML);
      const categoryMarkup = categories?.outerHTML;
      expect(screen.getAllByTestId("catalog-result-skeleton-card")).toHaveLength(desktopColumns * 2);
      view.rerender(<ProductCatalogShell {...props}><div data-testid="real-results">Confirmed result</div></ProductCatalogShell>);
      expect(screen.getByTestId("catalog-heading").outerHTML).toBe(heading);
      expect([...view.container.querySelectorAll("form,details")].map((node) => node.outerHTML)).toEqual(controls);
      expect(view.container.querySelector('[aria-label="Categories"]')?.outerHTML).toBe(categoryMarkup);
      expect(screen.queryByTestId("product-catalog-loading")).toBeNull();
    });
  }
  it("does not invent category geometry before actual catalog data exists", () => {
    render(<ProductCatalogLoading />);
    expect(screen.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Opening catalog");
    expect(screen.queryByTestId("catalog-category-list")).toBeNull();
    expect(screen.queryByTestId("catalog-result-skeleton-card")).toBeNull();
  });
});
