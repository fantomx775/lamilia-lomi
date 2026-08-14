/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CategoriesResourceList } from "./categories/categories-list";
import { PagesResourceList } from "./pages/pages-list";
import { ProductsResourceList } from "./products/products-list";
import { TagsResourceList } from "./tags/tags-list";
import { UsersResourceList } from "./users/users-list";

afterEach(() => {
  cleanup();
});

describe("admin resource list adapters", () => {
  it("connect all five admin resources to the shared list foundation", () => {
    const resources = [
      () => (
        <ProductsResourceList
          rows={[
            {
              id: "product-1",
              title: "Test product",
              slug: "test-product",
              status: "published",
              audience: "kids",
              productType: "coloring-book",
              languageCodes: ["en"],
            },
          ]}
        />
      ),
      () => (
        <CategoriesResourceList
          rows={[{ id: "category-1", name: "Books", slug: "books", sortOrder: 1, productCount: 1, languageCodes: ["en"] }]}
        />
      ),
      () => (
        <TagsResourceList
          rows={[{ id: "tag-1", name: "Calm", slug: "calm", productCount: 1, languageCodes: ["en"] }]}
        />
      ),
      () => (
        <UsersResourceList
          rows={[
            {
              id: "user@example.com",
              email: "user@example.com",
              role: "user",
              emailVerified: true,
              marketingConsent: false,
              unlockCount: 0,
            },
          ]}
        />
      ),
      () => (
        <PagesResourceList
          rows={[{ id: "privacy", title: "Privacy", slug: "privacy", languageCodes: ["en"], updatedAt: "today" }]}
        />
      ),
    ];

    for (const resource of resources) {
      const { container, unmount } = render(resource());
      expect(container.querySelector('[data-slot="data-table"]')).toBeInTheDocument();
      unmount();
    }
  });
});
