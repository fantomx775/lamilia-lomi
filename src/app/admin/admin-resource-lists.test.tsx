/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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

  it("exposes semantic links and buttons for each resource workflow", () => {
    const product = render(
      <ProductsResourceList rows={[{ id: "product-1", title: "Test product", slug: "test-product", status: "published", audience: "kids", productType: "coloring-book", languageCodes: ["en"] }]} />,
    );
    expect(product.container.querySelector('tbody a[href="/admin/products/product-1"]')).toBeInTheDocument();
    expect(product.container.querySelector('a[href="/admin/products/new"]')).toBeInTheDocument();
    expect(product.container.querySelector('tbody tr[role="button"]')).not.toBeInTheDocument();

    const category = render(
      <CategoriesResourceList
        rows={[{ id: "category-1", name: "Books", slug: "books", sortOrder: 1, productCount: 1, languageCodes: ["en"] }]}
        items={[{ id: "category-1", slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }] }]}
      />,
    );
    expect(category.getAllByRole("button", { name: "Edytuj kategorię Books" }).length).toBeGreaterThan(0);
    expect(category.getByRole("button", { name: /Dodaj kategorię/i })).toBeInTheDocument();

    const tag = render(
      <TagsResourceList
        rows={[{ id: "tag-1", name: "Calm", slug: "calm", productCount: 1, languageCodes: ["en"] }]}
        items={[{ id: "tag-1", slug: "calm", translations: [{ locale: "en", name: "Calm" }] }]}
      />,
    );
    expect(tag.getAllByRole("button", { name: "Edytuj tag Calm" }).length).toBeGreaterThan(0);
    expect(tag.getByRole("button", { name: /Dodaj tag/i })).toBeInTheDocument();

    const page = render(
      <PagesResourceList rows={[{ id: "privacy", title: "Privacy", slug: "privacy", languageCodes: ["en"], updatedAt: "today" }]} />,
    );
    expect(page.container.querySelector('tbody a[href="/admin/pages/privacy"]')).toBeInTheDocument();
    expect(page.container.querySelector('a[href="/admin/pages/new"]')).not.toBeInTheDocument();
    expect(page.queryByRole("link", { name: /Dodaj stronę/i })).not.toBeInTheDocument();

    const user = render(
      <UsersResourceList rows={[{ id: "user@example.com", email: "user@example.com", role: "user", emailVerified: true, marketingConsent: false, unlockCount: 1, unlockedProducts: ["Test product"] }]} />,
    );
    expect(user.getAllByRole("button", { name: /Pokaż szczegóły użytkownika user@example.com/ }).length).toBeGreaterThan(0);
    expect(user.getByRole("link", { name: "Eksport marketing CSV" })).toHaveAttribute("href", "/admin/users/export?marketingOnly=1");
  });

  it("opens category and user details as accessible drawers", async () => {
    const user = userEvent.setup();
    const category = render(
      <CategoriesResourceList
        rows={[{ id: "category-1", name: "Books", slug: "books", sortOrder: 1, productCount: 1, languageCodes: ["en"] }]}
        items={[{ id: "category-1", slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }] }]}
      />,
    );
    await user.click(category.getAllByRole("button", { name: "Edytuj kategorię Books" })[0]);
    expect(screen.getByRole("dialog", { name: "Edytuj kategorię" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /EN/ })).toBeInTheDocument();

    cleanup();
    const users = render(<UsersResourceList rows={[{ id: "user@example.com", email: "user@example.com", role: "user", emailVerified: true, marketingConsent: false, unlockCount: 1, unlockedProducts: ["Moon Garden"] }]} />);
    await user.click(users.getAllByRole("button", { name: /Pokaż szczegóły użytkownika user@example.com/ })[0]);
    expect(screen.getByRole("dialog", { name: "Szczegóły użytkownika" })).toHaveTextContent("Moon Garden");
    expect(screen.getByText(/tylko do odczytu/i)).toBeInTheDocument();
  });

  it("shows a safe retry state when the admin user reader is unavailable", () => {
    const users = render(<UsersResourceList rows={[]} loadError />);

    expect(users.getAllByRole("alert")[0]).toHaveTextContent("Lista użytkowników jest chwilowo niedostępna.");
    expect(users.getAllByRole("button", { name: "Spróbuj ponownie" })).toHaveLength(2);
    expect(users.queryByText(/Invalid API key/i)).not.toBeInTheDocument();
  });
});
