/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminMutationResult } from "@/lib/admin-errors";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: routerPush }),
}));

import { CategoriesResourceList } from "./categories/categories-list";
import { CollectionsResourceList } from "./collections/collections-list";
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
            },
          ]}
        />
      ),
      () => (
        <CategoriesResourceList
          rows={[{ id: "category-1", name: "Books", slug: "books", sortOrder: 1, productCount: 1 }]}
        />
      ),
      () => (
        <TagsResourceList
          rows={[{ id: "tag-1", name: "Calm", slug: "calm", productCount: 1 }]}
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
          rows={[{ id: "privacy", title: "Privacy", slug: "privacy", updatedAt: "today" }]}
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
      <ProductsResourceList rows={[{ id: "product-1", title: "Test product", slug: "test-product", status: "published", audience: "kids", productType: "coloring-book" }]} />,
    );
    expect(product.container.querySelector('tbody a[href="/admin/products/product-1"]')).toBeInTheDocument();
    expect(product.container.querySelector('a[href="/admin/products/new"]')).toBeInTheDocument();
    expect(product.container.querySelector('tbody tr[role="button"]')).not.toBeInTheDocument();
    expect(product.getAllByLabelText("Brak kategorii").length).toBeGreaterThan(0);
    expect(product.getAllByLabelText("Brak tagów").length).toBeGreaterThan(0);

    const category = render(
      <CategoriesResourceList
        rows={[{ id: "category-1", name: "Books", slug: "books", sortOrder: 1, productCount: 1 }]}
        items={[{ id: "category-1", slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }] }]}
      />,
    );
    expect(category.getAllByRole("button", { name: "Edytuj kategorię Books" }).length).toBeGreaterThan(0);
    expect(category.getByRole("button", { name: /Dodaj kategorię/i })).toBeInTheDocument();

    const tag = render(
      <TagsResourceList
        rows={[{ id: "tag-1", name: "Calm", slug: "calm", productCount: 1 }]}
        items={[{ id: "tag-1", slug: "calm", translations: [{ locale: "en", name: "Calm" }] }]}
      />,
    );
    expect(tag.getAllByRole("button", { name: "Edytuj tag Calm" }).length).toBeGreaterThan(0);
    expect(tag.getByRole("button", { name: /Dodaj tag/i })).toBeInTheDocument();

    const page = render(
      <PagesResourceList rows={[{ id: "privacy", title: "Privacy", slug: "privacy", updatedAt: "today" }]} />,
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

  it("opens a product from mobile metadata without hijacking overflow controls", async () => {
    const user = userEvent.setup();
    routerPush.mockClear();
    const product = render(
      <ProductsResourceList rows={[{
        id: "product-mobile",
        title: "Forest book",
        slug: "forest-book",
        status: "draft",
        audience: "kids",
        productType: "coloring-book",
        collectionName: "Forest stories",
        categoryNames: ["Books", "Nature", "Mindfulness"],
      }]} />,
    );
    const mobileDetails = product.container.querySelector("dl");
    expect(mobileDetails).not.toBeNull();

    await user.click(within(mobileDetails!).getByText("Forest stories"));
    expect(routerPush).toHaveBeenCalledWith("/admin/products/product-mobile");

    routerPush.mockClear();
    const categoryToggle = within(mobileDetails!).getByRole("button", { name: "Pokaż 1 kolejną kategorię" });
    await user.click(categoryToggle);
    expect(categoryToggle).toHaveAttribute("aria-expanded", "true");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("keeps long product titles readable and the archived status visible on desktop and mobile", async () => {
    const longTitle = `${"A very long illustrated story title ".repeat(4)}ending in the moonlit garden`;
    const longSlug = "moonlit-garden-" + "a-very-long-unbroken-slug-".repeat(8);
    const product = render(<ProductsResourceList rows={[{
      id: "long-title-product",
      title: longTitle,
      slug: longSlug,
      status: "archived",
      audience: "adults",
      productType: "coloring-book",
      categoryNames: ["Nature", "Stories", "Long category name " + "forest-".repeat(12)],
      tagNames: ["Moon", "Night", "Long tag " + "moon-".repeat(12)],
    }]} />);

    const desktopLink = product.container.querySelector<HTMLAnchorElement>('tbody a[href="/admin/products/long-title-product"]');
    expect(desktopLink).toHaveAttribute("aria-label", `Edytuj produkt ${longTitle}`);
    expect(desktopLink?.querySelector("span[title]")).toHaveAttribute("title", longTitle);
    expect(desktopLink).toHaveAttribute("href", "/admin/products/long-title-product");
    expect(product.container.querySelector("tbody tr[role='button']")).not.toBeInTheDocument();
    const desktopStatus = product.container.querySelector("tbody td:nth-child(2) span");
    expect(desktopStatus).toHaveTextContent("Zarchiwizowany");
    expect(desktopStatus).toHaveClass("shrink-0", "whitespace-nowrap");

    const user = userEvent.setup();
    await user.click(product.getByRole("textbox", { name: "Szukaj produktów" }));
    await user.keyboard("moonlit garden");
    expect(product.getAllByRole("link", { name: `Edytuj produkt ${longTitle}` })).toHaveLength(2);

    const mobileLink = product.container.querySelector<HTMLAnchorElement>(".xl\\:hidden a[href='/admin/products/long-title-product']");
    expect(mobileLink?.querySelector("p[title]")).toHaveAttribute("title", longTitle);
    expect(mobileLink).toHaveAttribute("aria-label", `Edytuj produkt ${longTitle}`);
    const mobileStatus = mobileLink?.querySelector("span.whitespace-nowrap");
    expect(mobileStatus).toHaveTextContent("Zarchiwizowany");
    expect(mobileStatus).toHaveClass("shrink-0", "whitespace-nowrap");
  });

  it("shows collection, category and tag columns with an accessible 2 plus N expansion", async () => {
    const user = userEvent.setup();
    const view = render(
      <ProductsResourceList rows={[
        {
          id: "product-collections",
          title: "Forest book",
          slug: "forest-book",
          status: "draft",
          audience: "kids",
          productType: "coloring-book",
          collectionName: "Forest stories",
          categoryNames: ["Books", "Nature", "A very long category name"],
          tagNames: ["Calm", "Printable", "Seasonal"],
        },
        {
          id: "product-count-3",
          title: "Three hidden labels",
          slug: "three-hidden-labels",
          status: "draft",
          audience: "kids",
          productType: "coloring-book",
          categoryNames: ["One", "Two", "Three", "Four", "Five"],
          tagNames: ["One", "Two", "Three", "Four", "Five"],
        },
        {
          id: "product-count-5",
          title: "Five hidden labels",
          slug: "five-hidden-labels",
          status: "draft",
          audience: "kids",
          productType: "coloring-book",
          categoryNames: ["One", "Two", "Three", "Four", "Five", "Six", "Seven"],
          tagNames: ["One", "Two", "Three", "Four", "Five", "Six", "Seven"],
        },
        {
          id: "product-count-22",
          title: "Twenty two hidden labels",
          slug: "twenty-two-hidden-labels",
          status: "draft",
          audience: "kids",
          productType: "coloring-book",
          categoryNames: Array.from({ length: 24 }, (_, index) => `Category ${index + 1}`),
          tagNames: Array.from({ length: 24 }, (_, index) => `Tag ${index + 1}`),
        },
      ]} />,
    );

    expect(view.getByRole("columnheader", { name: "Kolekcja" })).toBeInTheDocument();
    expect(view.getByRole("columnheader", { name: "Kategorie" })).toBeInTheDocument();
    expect(view.getByRole("columnheader", { name: "Tagi" })).toBeInTheDocument();
    expect(view.getAllByRole("button", { name: "Pokaż 1 kolejną kategorię" })).toHaveLength(2);
    expect(view.getAllByRole("button", { name: "Pokaż 1 kolejny tag" })).toHaveLength(2);
    expect(view.getAllByRole("button", { name: "Pokaż 3 kolejne kategorie" })).toHaveLength(2);
    expect(view.getAllByRole("button", { name: "Pokaż 3 kolejne tagi" })).toHaveLength(2);
    expect(view.getAllByRole("button", { name: "Pokaż 5 kolejnych kategorii" })).toHaveLength(2);
    expect(view.getAllByRole("button", { name: "Pokaż 5 kolejnych tagów" })).toHaveLength(2);
    expect(view.getAllByRole("button", { name: "Pokaż 22 kolejne kategorie" })).toHaveLength(2);
    expect(view.getAllByRole("button", { name: "Pokaż 22 kolejne tagi" })).toHaveLength(2);

    const expand = view.getAllByRole("button", { name: "Pokaż 1 kolejną kategorię" })[0];
    const detailsId = expand.getAttribute("aria-controls");
    expect(detailsId).toBeTruthy();
    expect(expand).toHaveAttribute("aria-haspopup", "true");
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(detailsId!)).toHaveAttribute("popover", "auto");
    const popoverIds = Array.from(document.querySelectorAll("[popover]")).map((popover) => popover.id);
    expect(new Set(popoverIds).size).toBe(popoverIds.length);
    expand.focus();
    await user.keyboard("{Enter}");

    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(detailsId!)).toHaveAttribute("popover", "auto");
    expect(view.getAllByText("A very long category name")).toHaveLength(2);
    expect(view.getAllByText("Forest stories")).toHaveLength(2);
  });

  it("keeps the collection drawer open while a save is pending", async () => {
    const user = userEvent.setup();
    const collectionId = "11111111-1111-4111-8111-111111111111";
    let resolveSave!: (result: Extract<AdminMutationResult, { ok: true }>) => void;
    const saveAction = vi.fn(() => new Promise<Extract<AdminMutationResult, { ok: true }>>((resolve) => {
      resolveSave = resolve;
    }));
    render(
      <CollectionsResourceList
        rows={[{
          id: collectionId,
          name: "Forest stories",
          slug: "forest-stories",
          sortOrder: 100,
          createdAt: "2026-10-12T00:00:00.000Z",
          updatedAt: "2026-10-12T00:00:00.000Z",
          productCount: 0,
        }]}
        saveAction={saveAction}
        deleteAction={vi.fn()}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "Edytuj kolekcję Forest stories" })[0]);
    await user.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));
    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog", { name: "Edytuj kolekcję" })).toBeInTheDocument();
    resolveSave({ ok: true, id: collectionId });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edytuj kolekcję" })).not.toBeInTheDocument());
  });

  it("uses Polish product-count plural forms", () => {
    const view = render(
      <CollectionsResourceList
        rows={[
          { id: "count-22", name: "Collection 22", slug: "collection-22", sortOrder: 1, createdAt: "today", updatedAt: "today", productCount: 22 },
          { id: "count-24", name: "Collection 24", slug: "collection-24", sortOrder: 2, createdAt: "today", updatedAt: "today", productCount: 24 },
          { id: "count-25", name: "Collection 25", slug: "collection-25", sortOrder: 3, createdAt: "today", updatedAt: "today", productCount: 25 },
          { id: "count-112", name: "Collection 112", slug: "collection-112", sortOrder: 4, createdAt: "today", updatedAt: "today", productCount: 112 },
          { id: "count-122", name: "Collection 122", slug: "collection-122", sortOrder: 5, createdAt: "today", updatedAt: "today", productCount: 122 },
        ]}
        saveAction={vi.fn()}
        deleteAction={vi.fn()}
      />,
    );

    expect(view.getByText("22 produkty")).toBeInTheDocument();
    expect(view.getByText("24 produkty")).toBeInTheDocument();
    expect(view.getByText("25 produktów")).toBeInTheDocument();
    expect(view.getByText("112 produktów")).toBeInTheDocument();
    expect(view.getByText("122 produkty")).toBeInTheDocument();
  });

  it("opens category and user details as accessible drawers", async () => {
    const user = userEvent.setup();
    const category = render(
      <CategoriesResourceList
        rows={[{ id: "category-1", name: "Books", slug: "books", sortOrder: 1, productCount: 1 }]}
        items={[{ id: "category-1", slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }] }]}
      />,
    );
    await user.click(category.getAllByRole("button", { name: "Edytuj kategorię Books" })[0]);
    expect(screen.getByRole("dialog", { name: "Edytuj kategorię" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Języki")).not.toBeInTheDocument();

    cleanup();
    const users = render(<UsersResourceList rows={[{ id: "user@example.com", email: "user@example.com", role: "user", emailVerified: true, marketingConsent: false, unlockCount: 1, unlockedProducts: ["Moon Garden"] }]} />);
    await user.click(users.getAllByRole("button", { name: /Pokaż szczegóły użytkownika user@example.com/ })[0]);
    expect(screen.getByRole("dialog", { name: "Szczegóły użytkownika" })).toHaveTextContent("Moon Garden");
    expect(screen.getByText(/tylko do odczytu/i)).toBeInTheDocument();
  });

  it("surfaces deferred category image cleanup after the category is deleted", async () => {
    const user = userEvent.setup();
    const deleteAction = vi.fn().mockResolvedValue({
      ok: true,
      id: "category-1",
      cleanupDeferred: true,
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(
      <CategoriesResourceList
        rows={[{ id: "category-1", name: "Books", slug: "books", sortOrder: 1, productCount: 1 }]}
        items={[{ id: "category-1", slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }] }]}
        deleteAction={deleteAction}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "Edytuj kategorię Books" })[0]);
    await user.click(screen.getByRole("button", { name: "Usuń kategorię" }));

    expect(deleteAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent("jej plik obrazu nie został usunięty");
    expect(screen.getByRole("alert")).toHaveTextContent("category-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("reports failed cleanup of an unsaved collection image without claiming it was saved", async () => {
    const user = userEvent.setup();
    const collectionId = "11111111-1111-4111-8111-111111111111";
    const imagePath = `collections/${collectionId}/image/22222222-2222-4222-8222-222222222222-cover.png`;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? {
          ok: true,
          json: async () => ({ image: {
            path: imagePath,
            provider: "local",
            filename: "cover.png",
            contentType: "image/png",
            sizeBytes: 16,
            url: "/api/admin/collection-image?pending=1",
          } }),
        }
      : { ok: false });
    const deleteAction = vi.fn().mockResolvedValue({ ok: true, id: collectionId });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(
      <CollectionsResourceList
        rows={[{
          id: collectionId,
          name: "Forest stories",
          slug: "forest-stories",
          sortOrder: 100,
          createdAt: "2026-10-12T00:00:00.000Z",
          updatedAt: "2026-10-12T00:00:00.000Z",
          productCount: 0,
        }]}
        saveAction={vi.fn()}
        deleteAction={deleteAction}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "Edytuj kolekcję Forest stories" })[0]);
    expect(document.querySelector<HTMLInputElement>('input[name="expectedUpdatedAt"]')?.value).toBe("2026-10-12T00:00:00.000Z");
    await user.upload(screen.getByLabelText("Wybierz obraz kolekcji"), new File(["image"], "cover.png", { type: "image/png" }));
    await screen.findByRole("button", { name: "Usuń obraz kolekcji" });
    await user.click(screen.getByRole("button", { name: "Usuń kolekcję" }));

    await waitFor(() => expect(deleteAction).toHaveBeenCalledTimes(1));
    const deleteForm = deleteAction.mock.calls[0]?.[0] as FormData;
    expect(deleteForm.get("expectedUpdatedAt")).toBe("2026-10-12T00:00:00.000Z");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/collection-image", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ collectionId, path: imagePath, provider: "local" }),
    })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się usunąć prywatnego obrazu");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Zmiana kolekcji powiodła się");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows a safe retry state when the admin user reader is unavailable", () => {
    const users = render(<UsersResourceList rows={[]} loadError />);

    expect(users.getAllByRole("alert")[0]).toHaveTextContent("Lista użytkowników jest chwilowo niedostępna.");
    expect(users.getAllByRole("button", { name: "Spróbuj ponownie" })).toHaveLength(2);
    expect(users.queryByText(/Invalid API key/i)).not.toBeInTheDocument();
  });
});
