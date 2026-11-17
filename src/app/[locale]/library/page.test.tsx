/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), product: vi.fn(), localized: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/session.server", () => ({ getDemoSession: mocks.session }));
vi.mock("@/lib/products-request", () => ({ getProductByIdForRequest: mocks.product, getLocalizedProductViewForRequest: mocks.localized }));
vi.mock("@/lib/community-flags", () => ({ getCommunityFlags: () => ({ publicEnabled: true, uploadsEnabled: true }) }));
vi.mock("@/lib/community/repository", () => ({ getMyCommunityProfile: mocks.profile }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => ({ title: "My Library", description: "Your files", emptyTitle: "No unlocked products yet", emptyDescription: "Unlock a book to start", guest: "Log in for your books", login: "Log in" })[key] }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: import("react").AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>, useLinkStatus: () => ({ pending: false }) }));
import LibraryPage from "./page";
beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());
it("keeps an unverified prior-unlock account distinct from a verified empty library", async () => {
  mocks.session.mockResolvedValue({ emailVerified: false, unlockedProductIds: ["previously-unlocked-book"] });
  render(await LibraryPage({ params: Promise.resolve({ locale: "en" }) }));
  expect(screen.getByTestId("library-unverified-state")).toBeVisible();
  expect(screen.getByText(/Your book access will be checked after verification/)).toHaveAttribute("role", "status");
  expect(screen.queryByText("No unlocked products yet")).toBeNull();
  expect(screen.queryByTestId("library-empty-state")).toBeNull();
  expect(screen.queryByRole("link", { name: "Open my files" })).toBeNull();
  expect(screen.getByRole("link", { name: "Open account" })).toHaveAttribute("href", "/en/account");
  expect(mocks.product).not.toHaveBeenCalled();
  expect(mocks.localized).not.toHaveBeenCalled();
});
it("shows the empty state only for a verified account with no unlocked books", async () => {
  mocks.session.mockResolvedValue({ emailVerified: true, unlockedProductIds: [] });
  render(await LibraryPage({ params: Promise.resolve({ locale: "en" }) }));
  expect(screen.getByTestId("library-empty-state")).toBeVisible();
  expect(screen.getByText("No unlocked products yet")).toBeVisible();
  expect(screen.queryByTestId("library-unverified-state")).toBeNull();
});
