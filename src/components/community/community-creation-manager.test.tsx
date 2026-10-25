// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommunityCreationManager } from "./community-creation-manager";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderManager() {
  return render(<CommunityCreationManager
    initialArtworks={[]}
    products={[{ id: "11111111-1111-4111-8111-111111111111", slug: "moon-garden", title: "Moon Garden" }]}
    uploadsEnabled
    canSubmit
    canEdit
    canDelete
    communityMember
    guidelinesHref="/en/community-guidelines"
    accountHref="/en/account"
    libraryHref="/en/library"
    preselectedProductId=""
  />);
}

function uploadResponse(artworkId: string) {
  return new Response(JSON.stringify({ ok: true, artwork: {
    id: artworkId,
    product: { id: "11111111-1111-4111-8111-111111111111", slug: "moon-garden", title: "Moon Garden", audience: "kids" },
    contentType: "image/webp", description: "", status: "pending", revision: 1,
    rejectionReason: null, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z",
  } }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("CommunityCreationManager", () => {
  it("sends three files sequentially and retries a failed item with its stable key and frozen payload", async () => {
    const user = userEvent.setup({ applyAccept: false });
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .mockReturnValueOnce("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
      .mockReturnValueOnce("cccccccc-cccc-4ccc-8ccc-cccccccccccc") });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: vi.fn() });
    const callOrder: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      const file = form.get("file") as File;
      callOrder.push(file.name);
      if (file.name === "second.png" && callOrder.length === 2) {
        return new Response(JSON.stringify({ ok: false, message: "Temporary problem. Try again." }), { status: 503 });
      }
      return uploadResponse(`dddddddd-dddd-4ddd-8ddd-${String(callOrder.length).padStart(12, "0")}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderManager();

    await user.selectOptions(screen.getByLabelText("Book"), "11111111-1111-4111-8111-111111111111");
    const files = ["first.png", "second.png", "third.png"].map((name) => new File([name], name, { type: "image/png" }));
    await user.upload(screen.getByTestId("community-upload-file-input"), files);
    await user.type(screen.getAllByLabelText(/Description Optional/)[1], "A small garden");
    await user.click(screen.getByTestId("community-upload-rules"));
    await user.click(screen.getByTestId("community-upload-submit"));

    await screen.findByRole("button", { name: "Retry this image" });
    expect(callOrder).toEqual(["first.png", "second.png", "third.png"]);
    expect(screen.getAllByTestId("community-artwork-card")).toHaveLength(2);
    const failedForm = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    const originalIdempotencyKey = failedForm.get("idempotencyKey");
    expect(failedForm.get("description")).toBe("A small garden");
    expect(screen.getAllByLabelText(/Description Optional/)[0]).toBeDisabled();

    await user.click(screen.getByTestId("community-artwork-retry"));
    await waitFor(() => expect(screen.queryByTestId("community-selected-artworks")).toBeNull());
    const retriedForm = fetchMock.mock.calls[3]?.[1]?.body as FormData;
    expect(retriedForm.get("idempotencyKey")).toBe(originalIdempotencyKey);
    expect(retriedForm.get("description")).toBe("A small garden");
    expect(screen.getAllByTestId("community-artwork-card")).toHaveLength(3);
  });

  it("does not block a valid file because a different selected file fails client validation", async () => {
    const user = userEvent.setup({ applyAccept: false });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: vi.fn() });
    const fetchMock = vi.fn(async () => uploadResponse("dddddddd-dddd-4ddd-8ddd-000000000001"));
    vi.stubGlobal("fetch", fetchMock);
    renderManager();
    await user.selectOptions(screen.getByLabelText("Book"), "11111111-1111-4111-8111-111111111111");
    await user.upload(screen.getByTestId("community-upload-file-input"), [
      new File(["valid"], "valid.png", { type: "image/png" }),
      new File(["bad"], "bad.gif", { type: "image/gif" }),
    ]);
    await user.click(screen.getByTestId("community-upload-rules"));
    expect(screen.getByTestId("community-upload-submit")).toBeEnabled();
    await user.click(screen.getByTestId("community-upload-submit"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findAllByText("Use a JPG, PNG, or WebP image.")).toHaveLength(1);
    expect(screen.getAllByTestId("community-artwork-card")).toHaveLength(1);
  });
});
