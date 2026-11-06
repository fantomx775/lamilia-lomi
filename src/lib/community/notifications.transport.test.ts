import { Resend } from "resend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const backend = vi.hoisted(() => ({ claims: vi.fn(), recipient: vi.fn(), prepare: vi.fn(), finish: vi.fn(), resend: vi.fn() }));
vi.mock("@/lib/config", () => ({ getBackendMode: () => "supabase" }));
vi.mock("@/lib/email", () => ({ getResendClient: backend.resend }));
vi.mock("./supabase-adapter", () => ({ claimModerationEmailOutbox: backend.claims,
  getModerationEmailRecipient: backend.recipient, prepareModerationEmailSend: backend.prepare,
  finishModerationEmailSend: backend.finish }));
import { processCommunityModerationNotifications } from "./notifications";

describe("actual Resend SDK cancellation contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_RESUME_SECRET", "isolated-fingerprint-secret-for-transport-only");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
    backend.resend.mockReturnValue(new Resend("re_synthetic_never_sent"));
    backend.claims.mockResolvedValue([{ moderation_event_id: 41, author_user_id: "fixture-author", notification_type: "approved" }]);
    backend.recipient.mockResolvedValue("fixture@example.test");
    backend.prepare.mockResolvedValue(true);
    backend.finish.mockResolvedValue(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("passes the stage signal to native fetch and leaves an ambiguous send leased without another mutation", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const reachedTransport = new Promise<void>((resolve) => { started = resolve; });
    const transport = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      expect(options.signal).toBe(controller.signal);
      expect(new Headers(options.headers).get("idempotency-key")).toBe("community-moderation/41");
      options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
      started();
    }));
    vi.stubGlobal("fetch", transport);
    const sending = processCommunityModerationNotifications(10, controller.signal);
    // Attach the rejection assertion before aborting to avoid an unhandled rejection.
    const stopped = expect(sending).rejects.toThrow("owned stage deadline");
    await reachedTransport;
    controller.abort(new Error("owned stage deadline"));
    await stopped;
    expect(transport).toHaveBeenCalledOnce();
    expect(backend.claims).toHaveBeenCalledWith(expect.any(String), 10, controller.signal);
    expect(backend.finish).not.toHaveBeenCalled();
  });
});
