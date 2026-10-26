import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  mode: "supabase",
  resend: { emails: { send: vi.fn() } } as null | { emails: { send: ReturnType<typeof vi.fn> } },
  claims: vi.fn(), recipient: vi.fn(), prepare: vi.fn(), finish: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ getBackendMode: () => mocks.mode }));
vi.mock("@/lib/email", () => ({ getResendClient: () => mocks.resend }));
vi.mock("./supabase-adapter", () => ({
  claimModerationEmailOutbox: mocks.claims,
  getModerationEmailRecipient: mocks.recipient,
  prepareModerationEmailSend: mocks.prepare,
  finishModerationEmailSend: mocks.finish,
}));

import { processCommunityModerationNotifications } from "./notifications";

const originalEnv = {
  secret: process.env.AUTH_RESUME_SECRET,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  publicEnabled: process.env.COLORING_CLUB_PUBLIC_ENABLED,
};
afterEach(() => {
  if (originalEnv.secret === undefined) delete process.env.AUTH_RESUME_SECRET; else process.env.AUTH_RESUME_SECRET = originalEnv.secret;
  if (originalEnv.appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = originalEnv.appUrl;
  if (originalEnv.publicEnabled === undefined) delete process.env.COLORING_CLUB_PUBLIC_ENABLED; else process.env.COLORING_CLUB_PUBLIC_ENABLED = originalEnv.publicEnabled;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = "supabase";
  mocks.resend = { emails: { send: vi.fn().mockResolvedValue({ data: { id: "resend-id" }, error: null }) } };
  mocks.claims.mockResolvedValue([{ moderation_event_id: 41, author_user_id: "author-private-id", notification_type: "approved", attempt_count: 1, first_attempt_at: null, payload_fingerprint: null, template_version: null }]);
  mocks.recipient.mockResolvedValue("author@example.test");
  mocks.prepare.mockResolvedValue(true);
  mocks.finish.mockResolvedValue(true);
  process.env.AUTH_RESUME_SECRET = "stable-test-key-for-community-notification-fingerprint";
  process.env.NEXT_PUBLIC_APP_URL = "https://lamilialomi.example";
});

describe("community moderation notification outbox", () => {
  it.each(["false", "true"])("sends a status-only approval email when public gallery flag is %s", async (publicEnabled) => {
    process.env.COLORING_CLUB_PUBLIC_ENABLED = publicEnabled;
    const result = await processCommunityModerationNotifications(1);
    expect(result).toMatchObject({ claimed: 1, sent: 1 });
    const message = mocks.resend?.emails.send.mock.calls[0]?.[0];
    expect(mocks.resend?.emails.send).toHaveBeenCalledWith(expect.objectContaining({
      to: ["author@example.test"], subject: "Your Coloring Club artwork was approved",
      text: expect.stringContaining("/en/library/creations"),
    }), { idempotencyKey: "community-moderation/41" });
    expect(message?.text).toContain("Your Coloring Club artwork was approved. You can review its status in My Creations.");
    expect(message?.text).not.toMatch(/visible in the gallery/i);
    expect(mocks.prepare).toHaveBeenCalledWith(41, expect.any(String), expect.stringMatching(/^[a-f0-9]{64}$/), "cc-status-2026-10-26-v2");
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ eventId: 41, result: "sent", providerMessageId: "resend-id" }));
    expect(JSON.stringify(mocks.prepare.mock.calls)).not.toContain("author@example.test");
  });

  it("suppresses sends to deleted, unverified, withdrawn, or inactive recipients", async () => {
    mocks.recipient.mockResolvedValueOnce(null);
    const result = await processCommunityModerationNotifications(1);
    expect(result).toMatchObject({ claimed: 1, suppressed: 1 });
    expect(mocks.resend?.emails.send).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ eventId: 41, result: "suppressed" }));
  });

  it("leaves records queued when Resend is unconfigured and never sends in local mode", async () => {
    mocks.resend = null;
    expect(await processCommunityModerationNotifications()).toMatchObject({ claimed: 0 });
    expect(mocks.claims).not.toHaveBeenCalled();
    mocks.resend = { emails: { send: vi.fn() } };
    mocks.mode = "local";
    expect(await processCommunityModerationNotifications()).toMatchObject({ claimed: 0 });
    expect(mocks.resend.emails.send).not.toHaveBeenCalled();
  });

  it("records provider failures for durable retry without leaking details", async () => {
    mocks.resend!.emails.send.mockResolvedValueOnce({ data: null, error: new Error("provider secret and recipient") });
    const result = await processCommunityModerationNotifications(1);
    expect(result).toMatchObject({ claimed: 1, retrying: 1 });
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ eventId: 41, result: "retry", errorCode: "provider_error" }));
    expect(JSON.stringify(mocks.finish.mock.calls)).not.toMatch(/provider secret|author@example/);
  });
});
