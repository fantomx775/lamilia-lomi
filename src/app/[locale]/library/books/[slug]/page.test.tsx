/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ product: vi.fn(), access: vi.fn(), backend: vi.fn(), signed: vi.fn() }));
vi.mock("@/lib/products-request", () => ({ getLocalizedProductDetailViewForRequest: mocks.product }));
vi.mock("@/lib/session.server", () => ({ getProductDetailAccessForRequest: mocks.access }));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.backend }));
vi.mock("@/lib/premium-core", () => ({ createSignedDownloadUrl: mocks.signed }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: import("react").AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>, useLinkStatus: () => ({ pending: false }) }));
import LibraryBookFilesPage from "./page";
const params = Promise.resolve({ locale: "en" as const, slug: "moon-garden" });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.product.mockResolvedValue({ id: "book-1", slug: "moon-garden", status: "published", title: "Moon Garden", premiumAssets: [{ id: "asset-1", title: "Coloring pages", contentType: "application/pdf" }] });
  mocks.backend.mockReturnValue("supabase");
  mocks.access.mockResolvedValue({ session: { emailVerified: true }, isUnlocked: true });
});
afterEach(() => cleanup());
describe("direct library files", () => {
  it("shows a guest login return to the exact file page without exposing download links", async () => {
    mocks.access.mockResolvedValue({ session: null, isUnlocked: false });
    render(await LibraryBookFilesPage({ params }));
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/en/login?returnTo=%2Fen%2Flibrary%2Fbooks%2Fmoon-garden");
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("requires verified email even when an unlock flag is present", async () => {
    mocks.access.mockResolvedValue({ session: { emailVerified: false }, isUnlocked: true });
    render(await LibraryBookFilesPage({ params }));
    expect(screen.getByRole("link", { name: "Open account" })).toHaveAttribute("href", "/en/account");
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
  });
  it("takes a locked reader to this book's unlock section", async () => {
    mocks.access.mockResolvedValue({ session: { emailVerified: true }, isUnlocked: false });
    render(await LibraryBookFilesPage({ params }));
    expect(screen.getByRole("link", { name: "Unlock this book" })).toHaveAttribute("href", "/en/products/moon-garden#premium");
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
  });
  it("exposes only the guarded download endpoint for an unlocked reader", async () => {
    render(await LibraryBookFilesPage({ params }));
    expect(screen.getByRole("link", { name: "Coloring pages Download PDF" })).toHaveAttribute("href", "/api/downloads/asset-1?locale=en&returnTo=%2Fen%2Flibrary%2Fbooks%2Fmoon-garden");
    expect(screen.getByRole("link", { name: "View book details" })).toHaveAttribute("href", "/en/products/moon-garden");
    expect(mocks.access).toHaveBeenCalledWith("book-1");
  });
  it("uses the existing session-bound signing path for the local backend", async () => {
    mocks.backend.mockReturnValue("local");
    mocks.access.mockResolvedValue({ session: { emailVerified: true }, isUnlocked: true, localSession: { email: "reader@example.test" } });
    mocks.signed.mockReturnValue({ ok: true, url: "/api/downloads/asset-1?test-signed=1" });
    render(await LibraryBookFilesPage({ params }));
    expect(screen.getByRole("link", { name: "Coloring pages Download PDF" })).toHaveAttribute("href", "/api/downloads/asset-1?test-signed=1");
    expect(mocks.signed).toHaveBeenCalledWith(expect.objectContaining({ product: { id: "book-1", status: "published" }, session: { email: "reader@example.test" } }));
  });
});
