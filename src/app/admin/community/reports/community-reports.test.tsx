/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import CommunityReports from "./community-reports";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const counts = { open: 1, reviewed: 0, resolved: 0, dismissed: 0 };

function report(id: string, status: "open" | "reviewed" = "open") {
  return {
    id,
    artworkId: `22222222-2222-4222-8222-${id.slice(-12)}`,
    artworkStatus: "approved" as const,
    description: `Report ${id}`,
    creatorUsername: `artist_${id.slice(-4)}`,
    product: { id: "33333333-3333-4333-8333-333333333333", slug: "test-book", title: "Test book", audience: "adults" as const },
    reason: "privacy" as const,
    details: "Controlled report detail",
    status,
    revision: 1,
    createdAt: "2026-10-24T12:00:00.000Z",
    updatedAt: "2026-10-24T12:00:00.000Z",
    overdue: false,
  };
}

function jsonResponse(items: ReturnType<typeof report>[]) {
  return new Response(JSON.stringify({ ok: true, items, nextCursor: null, counts }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("community reports admin queue", () => {
  it("keeps status controls disabled in SSR until hydrated", () => {
    const html = renderToString(<CommunityReports />);
    expect(html).toMatch(/data-testid="community-report-status-filter"[^>]*disabled/);
    expect(html).toMatch(/data-testid="community-report-count-open"[^>]*disabled/);
  });

  it("ignores a late response from the previous status filter", async () => {
    let resolveOpen!: (response: Response) => void;
    let resolveReviewed!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      return new Promise<Response>((resolve) => {
        if (url.searchParams.get("status") === "reviewed") resolveReviewed = resolve;
        else resolveOpen = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommunityReports />);
    await waitFor(() => expect(resolveOpen).toBeTypeOf("function"));

    await user.selectOptions(screen.getByTestId("community-report-status-filter"), "reviewed");
    await waitFor(() => expect(resolveReviewed).toBeTypeOf("function"));
    resolveReviewed(jsonResponse([report("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "reviewed")]));
    expect(await screen.findByText("@artist_bbbb")).toBeVisible();

    await act(async () => {
      resolveOpen(jsonResponse([report("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")]));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("@artist_aaaa")).not.toBeInTheDocument();
    expect(screen.getByText("@artist_bbbb")).toBeVisible();
  });

  it("locks filters and decision controls during one in-flight mutation", async () => {
    let resolveDecision!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return new Promise<Response>((resolve) => { resolveDecision = resolve; });
      return Promise.resolve(jsonResponse([report("cccccccc-cccc-4ccc-8ccc-cccccccccccc")]));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommunityReports />);
    const reviewButton = await screen.findByTestId("community-report-reviewed");
    await user.click(reviewButton);
    await waitFor(() => expect(resolveDecision).toBeTypeOf("function"));

    expect(screen.getByTestId("community-report-status-filter")).toBeDisabled();
    expect(screen.getByTestId("community-report-count-reviewed")).toBeDisabled();
    expect(reviewButton).toBeDisabled();
    expect(screen.getByTestId("community-report-resolve")).toBeDisabled();

    resolveDecision(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
