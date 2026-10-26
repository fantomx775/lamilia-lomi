/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({ default: (props: { src: string; alt: string; loading?: string; className?: string }) => createElement("img", props) }));

import { CommunityGallery } from "./community-gallery";
import type { CommunityPublicArtwork, CommunityPublicProductOption } from "@/lib/community/types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const product: CommunityPublicProductOption = { id: "11111111-1111-4111-8111-111111111111", slug: "spring-flowers", title: "Spring Flowers", audience: "kids" };
const artwork: CommunityPublicArtwork = {
  id: "22222222-2222-4222-8222-222222222222",
  product,
  creator: { username: "garden_artist", avatarSeed: "garden" },
  contentType: "image/webp",
  description: "A spring garden",
  publishedAt: "2026-10-25T12:00:00.000Z",
};

describe("public Coloring Club gallery", () => {
  it("renders approved cards with only gated app media paths and synchronized initial filters", () => {
    render(<CommunityGallery initialPage={{ items: [artwork], nextCursor: null }} products={[product]} initialAudience="kids" initialProductId={product.id} />);
    expect(screen.getByTestId("community-gallery-audience-filter")).toHaveValue("kids");
    expect(screen.getByTestId("community-gallery-product-filter")).toHaveValue(product.id);
    expect(screen.getByTestId("community-artwork-grid")).toHaveClass("grid-cols-2", "lg:grid-cols-4");
    expect(screen.getByRole("img", { name: "Coloring by @garden_artist: A spring garden" })).toHaveAttribute("src", `/api/community/artworks/${artwork.id}/media`);
    expect(screen.getByRole("link", { name: "View artwork by @garden_artist" })).toHaveAttribute("href", `/en/club/artworks/${artwork.id}`);
  });

  it("applies audience and book filters to the public latest endpoint", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      requestedUrls.push(String(args[0]));
      return new Response(JSON.stringify({ ok: true, items: [], nextCursor: null }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommunityGallery initialPage={{ items: [], nextCursor: null }} products={[product]} />);
    await user.selectOptions(screen.getByTestId("community-gallery-audience-filter"), "kids");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = new URL(requestedUrls[0], "http://localhost");
    expect(url.pathname).toBe("/api/community/artworks");
    expect(url.searchParams.get("audience")).toBe("kids");
    expect(url.searchParams.get("sort")).toBe("latest");
    await user.selectOptions(screen.getByTestId("community-gallery-product-filter"), product.id);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(new URL(requestedUrls[1], "http://localhost").searchParams.get("productId")).toBe(product.id);
  });

  it("ignores a late load-more response after filters change", async () => {
    let releaseLoadMore!: (response: Response) => void;
    const latePage = new Promise<Response>((resolve) => { releaseLoadMore = resolve; });
    const filteredArtwork = { ...artwork, id: "33333333-3333-4333-8333-333333333333", description: "Filtered result" };
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => latePage)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, items: [filteredArtwork], nextCursor: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommunityGallery initialPage={{ items: [artwork], nextCursor: "continuation" }} products={[product]} />);
    await user.click(screen.getByTestId("community-gallery-load-more"));
    await user.selectOptions(screen.getByTestId("community-gallery-audience-filter"), "kids");
    expect(await screen.findByText("Filtered result")).toBeVisible();
    releaseLoadMore(new Response(JSON.stringify({ ok: true, items: [{ ...artwork, id: "44444444-4444-4444-8444-444444444444", description: "Stale result" }], nextCursor: null }), { status: 200 }));
    await waitFor(() => expect(screen.queryByText("Stale result")).not.toBeInTheDocument());
    expect(screen.getByText("Filtered result")).toBeVisible();
  });

  it("clears stale cards on filter failure and lets the visitor retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, items: [artwork], nextCursor: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommunityGallery initialPage={{ items: [artwork], nextCursor: null }} products={[product]} />);
    await user.selectOptions(screen.getByTestId("community-gallery-audience-filter"), "kids");
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be updated");
    expect(screen.queryByRole("heading", { name: "No approved artwork here yet" })).not.toBeInTheDocument();
    expect(screen.queryByText("A spring garden")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("A spring garden")).toBeVisible();
  });
});
