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
  adminRecipient: process.env.COLORING_CLUB_ADMIN_EMAIL,
};
afterEach(() => {
  if (originalEnv.secret === undefined) delete process.env.AUTH_RESUME_SECRET; else process.env.AUTH_RESUME_SECRET = originalEnv.secret;
  if (originalEnv.appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = originalEnv.appUrl;
  if (originalEnv.publicEnabled === undefined) delete process.env.COLORING_CLUB_PUBLIC_ENABLED; else process.env.COLORING_CLUB_PUBLIC_ENABLED = originalEnv.publicEnabled;
  if (originalEnv.adminRecipient === undefined) delete process.env.COLORING_CLUB_ADMIN_EMAIL; else process.env.COLORING_CLUB_ADMIN_EMAIL = originalEnv.adminRecipient;
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
  process.env.COLORING_CLUB_ADMIN_EMAIL = "moderation@example.test";
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
    expect(message?.html).toContain('href="https://lamilialomi.example/en/library/creations"');
    expect(mocks.prepare).toHaveBeenCalledWith(41, expect.any(String), expect.stringMatching(/^[a-f0-9]{64}$/), "cc-moderation-2026-11-16-v1", undefined);
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ eventId: 41, result: "sent", providerMessageId: "resend-id" }), undefined);
    expect(JSON.stringify(mocks.prepare.mock.calls)).not.toContain("author@example.test");
  });

  it("delivers pending-review mail to the admin inbox without exposing author or description", async () => {
    mocks.claims.mockResolvedValueOnce([{ moderation_event_id: 42, author_user_id: null, notification_type: "admin_pending", template_version: null }]);
    expect(await processCommunityModerationNotifications(1)).toMatchObject({ claimed: 1, sent: 1 });
    expect(mocks.recipient).not.toHaveBeenCalled();
    expect(mocks.resend?.emails.send).toHaveBeenCalledWith(expect.objectContaining({
      to: ["moderation@example.test"],
      subject: "Coloring Club artwork is ready for review",
      html: expect.stringContaining('href="https://lamilialomi.example/admin/community"'),
    }), { idempotencyKey: "community-moderation/42" });
  });

  it("does not consume delivery attempts when the admin recipient is missing", async () => {
    delete process.env.COLORING_CLUB_ADMIN_EMAIL;
    expect(await processCommunityModerationNotifications(1)).toMatchObject({ status: "unconfigured", reason: "admin_recipient", claimed: 0 });
    expect(mocks.claims).not.toHaveBeenCalled();
    expect(mocks.resend?.emails.send).not.toHaveBeenCalled();
  });

  it.each([null, "cc-status-2026-10-26-v2"])("sends a rejection and preserves the plain-text payload on legacy retries (%s)", async (version) => {
    mocks.claims.mockResolvedValueOnce([{ moderation_event_id: 43, author_user_id: "author-private-id", notification_type: "rejected", template_version: version }]);
    expect(await processCommunityModerationNotifications(1)).toMatchObject({ claimed: 1, sent: 1 });
    const message = mocks.resend?.emails.send.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      to: ["author@example.test"],
      subject: "Your Coloring Club artwork was reviewed",
      text: "Your Coloring Club artwork was not approved. You can review its status in My Creations.\n\nView your creations: https://lamilialomi.example/en/library/creations",
    });
    if (version) {
      expect(message).not.toHaveProperty("html");
      expect(mocks.prepare).toHaveBeenCalledWith(43, expect.any(String), expect.any(String), version, undefined);
    } else {
      expect(message.html).toContain("View your creations");
    }
  });

  it("suppresses sends to deleted, unverified, withdrawn, or inactive recipients", async () => {
    mocks.recipient.mockResolvedValueOnce(null);
    const result = await processCommunityModerationNotifications(1);
    expect(result).toMatchObject({ claimed: 1, suppressed: 1 });
    expect(mocks.resend?.emails.send).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ eventId: 41, result: "suppressed" }), undefined);
  });

  it("distinguishes an unconfigured provider from an idle configured dispatcher without claiming work", async () => {
    mocks.resend = null;
    expect(await processCommunityModerationNotifications()).toEqual({
      status: "unconfigured", reason: "email_provider", claimed: 0, sent: 0, suppressed: 0, retrying: 0,
    });
    expect(mocks.claims).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
    mocks.resend = { emails: { send: vi.fn() } };
    mocks.claims.mockResolvedValue([]);
    expect(await processCommunityModerationNotifications()).toEqual({
      status: "ready", claimed: 0, sent: 0, suppressed: 0, retrying: 0,
    });
    expect(mocks.claims).toHaveBeenCalledOnce();
    expect(mocks.resend.emails.send).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "short-secret"])("reports a missing/short fingerprint secret without claiming or sending", async (secret) => {
    if (secret === undefined) delete process.env.AUTH_RESUME_SECRET;
    else process.env.AUTH_RESUME_SECRET = secret;
    const result = await processCommunityModerationNotifications();
    expect(result).toEqual({
      status: "unconfigured", reason: "fingerprint_secret", claimed: 0, sent: 0, suppressed: 0, retrying: 0,
    });
    expect(mocks.claims).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.resend?.emails.send).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("short-secret");
  });

  it("explicitly disables dispatch in local mode even without provider credentials", async () => {
    mocks.mode = "local";
    mocks.resend = null;
    expect(await processCommunityModerationNotifications()).toEqual({
      status: "disabled", reason: "local_backend", claimed: 0, sent: 0, suppressed: 0, retrying: 0,
    });
    expect(mocks.claims).not.toHaveBeenCalled();
  });

  it("records provider failures for durable retry without leaking details", async () => {
    mocks.resend!.emails.send.mockResolvedValueOnce({ data: null, error: new Error("provider secret and recipient") });
    const result = await processCommunityModerationNotifications(1);
    expect(result).toMatchObject({ claimed: 1, retrying: 1 });
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ eventId: 41, result: "retry", errorCode: "provider_error" }), undefined);
    expect(JSON.stringify(mocks.finish.mock.calls)).not.toMatch(/provider secret|author@example/);
  });
});
