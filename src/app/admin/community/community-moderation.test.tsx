// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CommunityModeration from "./community-moderation";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const artwork = {
  id, product: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", slug: "garden-book", title: "Garden Book", audience: "kids" as const },
  contentType: "image/webp" as const, description: "A flower garden", status: "pending" as const,
  revision: 1, rejectionReason: null, createdAt: "2026-10-25T12:00:00.000Z", updatedAt: "2026-10-25T12:00:00.000Z",
  creatorUsername: "garden_user", publishedAt: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("admin community moderation UI", () => {
  it("shows private preview/history and requires a reason before a reject request", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/moderation")) return new Response(JSON.stringify({ ok: true, artwork: { ...artwork, status: "rejected", revision: 2 }, history: [] }), { status: 200 });
      if (url.endsWith(`/${id}`)) return new Response(JSON.stringify({ ok: true, artwork, history: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, items: [artwork], nextCursor: null, counts: { pending: 1, approved: 0, rejected: 0, removed: 0 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CommunityModeration products={[{ id: artwork.product.id, title: "Garden Book" }]} />);
    expect(await screen.findByText("@garden_user")).toBeTruthy();
    expect(await screen.findByTestId("community-moderation-preview")).toHaveAttribute("src", `/api/community/artworks/${id}/media`);
    fireEvent.click(screen.getByTestId("community-moderation-reject"));
    fireEvent.click(screen.getByTestId("community-moderation-confirm"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("community-moderation-reason")).toBeTruthy();
    fireEvent.change(screen.getByTestId("community-moderation-reason"), { target: { value: "Please remove personal details." } });
    fireEvent.click(screen.getByTestId("community-moderation-confirm"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ action: "reject", revision: 1, reason: "Please remove personal details." });
  });

  it("shows stale decision conflicts with an explicit refresh control", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/moderation")) return new Response(JSON.stringify({ ok: false, message: "conflict" }), { status: 409 });
      if (url.endsWith(`/${id}`)) return new Response(JSON.stringify({ ok: true, artwork, history: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, items: [artwork], nextCursor: null, counts: { pending: 1, approved: 0, rejected: 0, removed: 0 } }), { status: 200 });
    }));
    render(<CommunityModeration products={[]} />);
    await screen.findByText("@garden_user");
    fireEvent.click(await screen.findByTestId("community-moderation-approve"));
    fireEvent.click(screen.getByTestId("community-moderation-confirm"));
    expect(await screen.findByRole("alert")).toHaveTextContent("innego administratora");
    expect(screen.getByRole("button", { name: "Odśwież" })).toBeTruthy();
  });

  it("ignores an older filter response that resolves after the current queue", async () => {
    const otherId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const newer = { ...artwork, id: otherId, status: "approved" as const, creatorUsername: "new_author", description: "Newest filtered result" };
    const older = { ...artwork, creatorUsername: "old_author", description: "Stale pending result" };
    let resolveOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("?status=pending")) return oldResponse;
      if (url.includes("?status=approved")) return new Response(JSON.stringify({ ok: true, items: [newer], nextCursor: null, counts: { pending: 1, approved: 1, rejected: 0, removed: 0 } }), { status: 200 });
      if (url.endsWith(`/${otherId}`)) return new Response(JSON.stringify({ ok: true, artwork: newer, history: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, artwork: older, history: [] }), { status: 200 });
    }));
    render(<CommunityModeration products={[]} />);
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    fireEvent.change(screen.getByTestId("community-moderation-status-filter"), { target: { value: "approved" } });
    expect(await screen.findByText("Newest filtered result")).toBeTruthy();
    resolveOld(new Response(JSON.stringify({ ok: true, items: [older], nextCursor: null, counts: { pending: 1, approved: 0, rejected: 0, removed: 0 } }), { status: 200 }));
    await waitFor(() => expect(screen.getByTestId("community-moderation-queue")).toHaveTextContent("@new_author"));
    expect(screen.queryByText("Stale pending result")).toBeNull();
  });

  it("clears an armed decision and hides controls while switching selected artwork", async () => {
    const second = { ...artwork, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", creatorUsername: "second_author", description: "Second work description" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/${second.id}`)) return new Response(JSON.stringify({ ok: true, artwork: second, history: [] }), { status: 200 });
      if (url.endsWith(`/${id}`)) return new Response(JSON.stringify({ ok: true, artwork, history: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, items: [artwork, second], nextCursor: null, counts: { pending: 2, approved: 0, rejected: 0, removed: 0 } }), { status: 200 });
    }));
    render(<CommunityModeration products={[]} />);
    fireEvent.click(await screen.findByTestId("community-moderation-reject"));
    expect(screen.getByTestId("community-moderation-confirm")).toBeTruthy();
    fireEvent.click(screen.getAllByTestId("community-moderation-item")[1]);
    expect(screen.queryByTestId("community-moderation-confirm")).toBeNull();
    expect(await screen.findByText("Second work description")).toBeTruthy();
    expect(screen.queryByTestId("community-moderation-confirm")).toBeNull();
  });

  it("freezes queue and filters while a moderation decision is pending", async () => {
    let resolveModeration!: (response: Response) => void;
    const moderationResponse = new Promise<Response>((resolve) => { resolveModeration = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/moderation")) return moderationResponse;
      if (url.endsWith(`/${id}`)) return new Response(JSON.stringify({ ok: true, artwork, history: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, items: [artwork], nextCursor: "next", counts: { pending: 1, approved: 0, rejected: 0, removed: 0 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CommunityModeration products={[]} />);
    fireEvent.click(await screen.findByTestId("community-moderation-approve"));
    fireEvent.click(screen.getByTestId("community-moderation-confirm"));
    await waitFor(() => expect(resolveModeration).toBeTypeOf("function"));
    expect(screen.getByTestId("community-moderation-item")).toBeDisabled();
    expect(screen.getByTestId("community-moderation-status-filter")).toBeDisabled();
    expect(screen.getByTestId("community-count-approved")).toBeDisabled();
    expect(screen.getByTestId("community-moderation-author-filter")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Filtruj" })).toBeDisabled();
    resolveModeration(new Response(JSON.stringify({ ok: true, artwork: { ...artwork, status: "approved", revision: 2 }, history: [] }), { status: 200 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it("reloads selected detail after a conflict so the next action uses its current revision", async () => {
    let queueCalls = 0;
    let detailCalls = 0;
    let moderationCalls = 0;
    const updated = { ...artwork, revision: 2, updatedAt: "2026-10-26T12:00:00.000Z" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/moderation")) {
        moderationCalls += 1;
        if (moderationCalls === 1) return new Response(JSON.stringify({ ok: false, message: "conflict" }), { status: 409 });
        return new Response(JSON.stringify({ ok: true, artwork: { ...updated, status: "approved", revision: 3 }, history: [] }), { status: 200 });
      }
      if (url.endsWith(`/${id}`)) {
        detailCalls += 1;
        const current = detailCalls === 1 ? artwork : updated;
        return new Response(JSON.stringify({ ok: true, artwork: current, history: [] }), { status: 200 });
      }
      queueCalls += 1;
      const items = queueCalls === 1 ? [artwork] : queueCalls === 2 ? [updated] : [];
      return new Response(JSON.stringify({ ok: true, items, nextCursor: null, counts: { pending: items.length, approved: 0, rejected: 0, removed: 0 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CommunityModeration products={[]} />);
    fireEvent.click(await screen.findByTestId("community-moderation-approve"));
    fireEvent.click(screen.getByTestId("community-moderation-confirm"));
    expect(await screen.findByRole("alert")).toHaveTextContent("innego administratora");
    fireEvent.click(screen.getByRole("button", { name: "Odśwież" }));
    expect(await screen.findByText(/wersja 2/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("community-moderation-approve"));
    fireEvent.click(screen.getByTestId("community-moderation-confirm"));
    await waitFor(() => expect(moderationCalls).toBe(2));
    const postRequests = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/moderation"));
    expect(JSON.parse(String(postRequests[1]?.[1]?.body))).toMatchObject({ action: "approve", revision: 2 });
  });

  it("keeps loaded detail when the already-selected queue row is clicked again", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/${id}`)) return new Response(JSON.stringify({ ok: true, artwork, history: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, items: [artwork], nextCursor: null, counts: { pending: 1, approved: 0, rejected: 0, removed: 0 } }), { status: 200 });
    }));
    render(<CommunityModeration products={[]} />);
    expect(await screen.findByTestId("community-moderation-preview")).toBeTruthy();
    fireEvent.click(screen.getByTestId("community-moderation-item"));
    expect(screen.getByTestId("community-moderation-preview")).toBeTruthy();
    expect(screen.getByTestId("community-moderation-approve")).toBeTruthy();
  });
});
