import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ moderate: vi.fn(), getDetail: vi.fn(), sendNotifications: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/community/repository", () => ({
  moderateCommunityArtwork: mocks.moderate,
  getCommunityModerationArtwork: mocks.getDetail,
}));
vi.mock("@/lib/community/admin-http", () => ({ getCommunityAdminAccess: vi.fn(async () => ({ actor: { userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", emailVerified: true, role: "admin" } })) }));
vi.mock("@/lib/community/notifications", () => ({ processCommunityModerationNotifications: mocks.sendNotifications }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));

import { POST } from "./route";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const context = { params: Promise.resolve({ id }) };
const detail = { artwork: { id, status: "approved", revision: 2 }, history: [] };

function request(body: unknown, origin = "https://example.test") {
  return new Request(`https://example.test/api/admin/community/artworks/${id}/moderation`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("admin community moderation endpoint", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.sendNotifications.mockResolvedValue({ claimed: 0, sent: 0, suppressed: 0, retrying: 0 }); });
  it("requires same-origin, bounded allowlisted decisions with revision", async () => {
    const crossOrigin = await POST(request({ action: "approve", revision: 1 }, "https://attacker.test"), context);
    expect(crossOrigin.status).toBe(403);
    const spoofed = await POST(request({ action: "approve", revision: 1, actor_user_id: "spoof" }), context);
    expect(spoofed.status).toBe(400);
    const missingReason = await POST(request({ action: "reject", revision: 1, reason: "   " }), context);
    expect(missingReason.status).toBe(400);
    expect(mocks.moderate).not.toHaveBeenCalled();
  });

  it("records an authorized action using only the supplied CAS revision and returns safe detail", async () => {
    mocks.moderate.mockResolvedValueOnce(2);
    mocks.getDetail.mockResolvedValueOnce(detail);
    const response = await POST(request({ action: "reject", revision: 1, reason: "Remove contact information." }), context);
    expect(response.status).toBe(200);
    expect(mocks.moderate).toHaveBeenCalledWith(id, 1, "reject", "Remove contact information.");
    expect(await response.json()).toMatchObject({ ok: true, artwork: { id, status: "approved" }, history: [] });
  });

  it("keeps a committed moderation decision successful when the outbox worker is unavailable", async () => {
    mocks.moderate.mockResolvedValueOnce(2);
    mocks.getDetail.mockResolvedValueOnce(detail);
    mocks.sendNotifications.mockRejectedValueOnce(new Error("provider diagnostics"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await POST(request({ action: "approve", revision: 1 }), context);
      expect(response.status).toBe(200);
      expect(mocks.moderate).toHaveBeenCalledOnce();
      expect(mocks.after).toHaveBeenCalledOnce();
      const callback = mocks.after.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
      expect(callback).toBeDefined();
      await callback?.();
      expect(mocks.sendNotifications).toHaveBeenCalledWith(1);
      expect(log).toHaveBeenCalledWith("[community-notification] Moderation email remains queued for a later retry.");
    } finally { log.mockRestore(); }
  });
});
