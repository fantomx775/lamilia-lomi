// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommunityCreationManager } from "./community-creation-manager";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderManager(initialArtworks: Array<{
  id: string;
  product: { id: string; slug: string; title: string; audience: "kids" | "adults" };
  contentType: "image/webp";
  description: string;
  status: "pending" | "approved" | "rejected" | "removed";
  revision: number;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}> = []) {
  return render(<CommunityCreationManager
    initialArtworks={initialArtworks}
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
  it("keeps selected previews and descriptions when the upload drawer closes and reopens", async () => {
    const user = userEvent.setup({ applyAccept: false });
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
    renderManager();

    const trigger = screen.getByTestId("community-upload-open");
    await user.click(trigger);
    await user.selectOptions(screen.getByLabelText("Book"), "11111111-1111-4111-8111-111111111111");
    await user.upload(screen.getByTestId("community-upload-file-input"), new File(["image"], "garden.png", { type: "image/png" }));
    await user.type(screen.getByLabelText(/Description Optional/), "A little garden");
    expect(document.body.style.overflow).toBe("hidden");

    const dialog = screen.getByRole("dialog", { name: "Share your art" });
    await user.click(within(dialog).getByRole("button", { name: "Close upload" }));
    const backdrop = document.body.querySelector('[data-slot="admin-drawer"]');
    fireEvent(backdrop!, new Event("animationend", { bubbles: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    expect(screen.getByTestId("community-selected-artworks")).toBeInTheDocument();
    expect(screen.getByLabelText(/Description Optional/)).toHaveValue("A little garden");
  });

  it("edits and saves an existing artwork description without losing the input event value", async () => {
    const user = userEvent.setup();
    const artwork = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      product: { id: "11111111-1111-4111-8111-111111111111", slug: "moon-garden", title: "Moon Garden", audience: "kids" as const },
      contentType: "image/webp" as const,
      description: "Original description",
      status: "approved" as const,
      revision: 2,
      rejectionReason: null,
      createdAt: "2026-10-25T00:00:00Z",
      updatedAt: "2026-10-25T00:00:00Z",
    };
    const updatedArtwork = { ...artwork, description: "A new description", status: "pending" as const, revision: 3 };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ revision: 2, description: "A new description" });
      return new Response(JSON.stringify({ ok: true, artwork: updatedArtwork }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderManager([artwork]);

    await user.click(screen.getByTestId("community-artwork-edit-description"));
    const description = screen.getByTestId("community-artwork-description");
    await user.clear(description);
    await user.type(description, "A new description");
    await user.click(screen.getByTestId("community-artwork-save-description"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Pending review · private")).toBeInTheDocument();
    expect(screen.getByText("A new description")).toBeInTheDocument();
    expect(screen.queryByTestId("community-artwork-description")).toBeNull();
    expect(screen.queryByTestId("community-artwork-save-description")).toBeNull();
  });

  it("blocks delete while a description save is pending and prevents duplicate deletion", async () => {
    const user = userEvent.setup();
    const artwork = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      product: { id: "11111111-1111-4111-8111-111111111111", slug: "moon-garden", title: "Moon Garden", audience: "kids" as const },
      contentType: "image/webp" as const,
      description: "Original description",
      status: "approved" as const,
      revision: 1,
      rejectionReason: null,
      createdAt: "2026-10-25T00:00:00Z",
      updatedAt: "2026-10-25T00:00:00Z",
    };
    const updatedArtwork = { ...artwork, description: "Updated description", status: "pending" as const, revision: 2 };
    let resolveSave!: (response: Response) => void;
    let resolveDelete!: (response: Response) => void;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return await new Promise<Response>((resolve) => { resolveSave = resolve; });
      if (init?.method === "DELETE") return await new Promise<Response>((resolve) => { resolveDelete = resolve; });
      throw new Error("Unexpected request method.");
    });
    vi.stubGlobal("fetch", fetchMock);
    renderManager([artwork]);

    await user.click(screen.getByTestId("community-artwork-edit-description"));
    await user.clear(screen.getByTestId("community-artwork-description"));
    await user.type(screen.getByTestId("community-artwork-description"), "Updated description");
    await user.click(screen.getByTestId("community-artwork-save-description"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const deleteButton = screen.getByTestId("community-artwork-delete");
    expect(deleteButton).toBeDisabled();
    await user.click(deleteButton);
    expect(screen.queryByRole("group", { name: "Confirm artwork deletion" })).toBeNull();

    resolveSave(new Response(JSON.stringify({ ok: true, artwork: updatedArtwork }), { status: 200 }));
    await screen.findByText("Your description was saved. This artwork is pending review again.");
    await user.click(screen.getByTestId("community-artwork-delete"));
    await user.click(screen.getByTestId("community-artwork-confirm-delete"));
    await screen.findByText("Deleting…");

    const confirmDelete = screen.getByTestId("community-artwork-confirm-delete");
    expect(confirmDelete).toBeDisabled();
    await user.click(confirmDelete);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveDelete(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(screen.queryByTestId("community-artwork-card")).toBeNull());
  });

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

    await user.click(screen.getByTestId("community-upload-open"));
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
    await user.click(screen.getByTestId("community-upload-open"));
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
