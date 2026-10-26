import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ moderate: vi.fn(), getDetail: vi.fn() }));
vi.mock("@/lib/community/repository", () => ({
  moderateCommunityArtwork: mocks.moderate,
  getCommunityModerationArtwork: mocks.getDetail,
}));
vi.mock("@/lib/community/admin-http", () => ({ getCommunityAdminAccess: vi.fn(async () => ({ actor: { userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", emailVerified: true, role: "admin" } })) }));

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
});
