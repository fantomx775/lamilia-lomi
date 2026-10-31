import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const cleanup = vi.hoisted(() => ({ media: vi.fn(), accountMedia: vi.fn(), retention: vi.fn(), notifications: vi.fn() }));
vi.mock("@/lib/community/repository", () => ({ processCommunityArtworkCleanup: cleanup.media, processCommunityAccountMediaCleanup: cleanup.accountMedia, processCommunityReportRetention: cleanup.retention }));
vi.mock("@/lib/community/notifications", () => ({ processCommunityModerationNotifications: cleanup.notifications }));
import { GET } from "./route";

const token = "isolated-unit-fixture-secret-32-characters";
const request = (authorization?: string) => new Request("https://example.test/api/internal/community/cleanup", {
  headers: authorization ? { authorization } : {},
});

describe("protected scheduled community cleanup", () => {
  beforeEach(() => {
    cleanup.media.mockReset().mockResolvedValue(undefined);
    cleanup.accountMedia.mockReset().mockResolvedValue({ claimed: 0 });
    cleanup.retention.mockReset().mockResolvedValue(undefined);
    cleanup.notifications.mockReset().mockResolvedValue({ status: "ready", claimed: 0, sent: 0, suppressed: 0, retrying: 0 });
    vi.stubEnv("CRON_SECRET", token);
    vi.stubEnv("COLORING_CLUB_PUBLIC_ENABLED", "false");
    vi.stubEnv("COLORING_CLUB_UPLOADS_ENABLED", "false");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when the scheduler is unconfigured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer undefined"))).status).toBe(503);
    expect(cleanup.media).not.toHaveBeenCalled();
  });
  it.each([undefined, "Bearer wrong", `Basic ${token}`, token])("denies an unauthorized request", async (authorization) => {
    const response = await GET(request(authorization));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(cleanup.media).not.toHaveBeenCalled();
  });
  it("drains bounded batches even with both community features paused", async () => {
    const response = await GET(request(`Bearer ${token}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, passes: 10,
      stages: { retention: "completed", notifications: "completed", artworkMedia: "completed", accountMedia: "completed" },
      notifications: { status: "ready", claimed: 0, sent: 0, suppressed: 0, retrying: 0 } });
    expect(cleanup.media).toHaveBeenCalledTimes(10);
    expect(cleanup.accountMedia).toHaveBeenCalledWith(10, expect.any(AbortSignal));
    expect(cleanup.retention).toHaveBeenCalledOnce();
    expect(cleanup.notifications).toHaveBeenCalledWith(10, expect.any(AbortSignal));
  });
  it.each(["email_provider", "fingerprint_secret"])("reports %s configuration failure after cleanup while the club is paused", async (reason) => {
    cleanup.notifications.mockResolvedValue({ status: "unconfigured", reason, claimed: 0, sent: 0, suppressed: 0, retrying: 0 });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await GET(request(`Bearer ${token}`));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json();
      expect(body).toEqual({ ok: false, error: "notifications_unconfigured", passes: 10,
        stages: { retention: "completed", notifications: "completed", artworkMedia: "completed", accountMedia: "completed" },
        notifications: { status: "unconfigured", reason, claimed: 0, sent: 0, suppressed: 0, retrying: 0 } });
      expect(cleanup.media).toHaveBeenCalledTimes(10);
      expect(cleanup.accountMedia).toHaveBeenCalledWith(10, expect.any(AbortSignal));
      expect(cleanup.retention).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith("[community-maintenance] Maintenance incomplete: notifications_unconfigured.");
      expect(JSON.stringify({ body, logs: log.mock.calls })).not.toContain(token);
    } finally { log.mockRestore(); }
  });
  it("keeps local maintenance successful with explicitly disabled notifications", async () => {
    cleanup.notifications.mockResolvedValue({ status: "disabled", reason: "local_backend", claimed: 0, sent: 0, suppressed: 0, retrying: 0 });
    const response = await GET(request(`Bearer ${token}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, notifications: { status: "disabled", reason: "local_backend" } });
  });
  it("reports a backend failure without leaking the secret or backend details", async () => {
    cleanup.media.mockRejectedValue(new Error("private backend diagnostics"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await GET(request(`Bearer ${token}`));
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).not.toContain(token);
      expect(body).not.toContain("private backend diagnostics");
      expect(cleanup.media).toHaveBeenCalledTimes(1);
      expect(cleanup.retention).toHaveBeenCalledOnce();
      expect(cleanup.notifications).toHaveBeenCalledOnce();
      expect(cleanup.accountMedia).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
});
