import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const work = vi.hoisted(() => ({ retention: vi.fn(), notifications: vi.fn(), media: vi.fn(), account: vi.fn() }));
vi.mock("./repository", () => ({ processCommunityReportRetention: work.retention,
  processCommunityArtworkCleanup: work.media, processCommunityAccountMediaCleanup: work.account }));
vi.mock("./notifications", () => ({ processCommunityModerationNotifications: work.notifications }));
import { runCommunityMaintenance } from "./maintenance";

describe("independent maintenance execution budgets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    work.retention.mockReset().mockResolvedValue(undefined);
    work.notifications.mockReset().mockResolvedValue({ status: "ready", claimed: 0, sent: 0, suppressed: 0, retrying: 0 });
    work.media.mockReset().mockResolvedValue(undefined);
    work.account.mockReset().mockResolvedValue({ claimed: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it("awaits aborted storage I/O, stops further batches, and still runs retention, email and account cleanup", async () => {
    let activeDeletes = 0;
    work.media.mockImplementation((_actor, signal: AbortSignal) => new Promise((_resolve, reject) => {
      activeDeletes += 1;
      signal.addEventListener("abort", () => { activeDeletes -= 1; reject(signal.reason); }, { once: true });
    }));
    const running = runCommunityMaintenance();
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await running;
    expect(result).toMatchObject({ ok: false, error: "maintenance_incomplete", passes: 0,
      stages: { retention: "completed", notifications: "completed", artworkMedia: "deferred", accountMedia: "completed" } });
    expect(work.retention).toHaveBeenCalledOnce();
    expect(work.notifications).toHaveBeenCalledOnce();
    expect(work.media).toHaveBeenCalledOnce();
    expect(work.account).toHaveBeenCalledOnce();
    expect(work.retention.mock.invocationCallOrder[0]).toBeLessThan(work.media.mock.invocationCallOrder[0]);
    expect(work.notifications.mock.invocationCallOrder[0]).toBeLessThan(work.media.mock.invocationCallOrder[0]);
    expect(activeDeletes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives every stalled stage a cancelable attempt within the platform duration without overlapping mutations", async () => {
    let active = 0;
    let maxActive = 0;
    const stalled = (signal: AbortSignal) => new Promise((_resolve, reject) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      signal.addEventListener("abort", () => { active -= 1; reject(signal.reason); }, { once: true });
    });
    work.retention.mockImplementation(stalled);
    work.notifications.mockImplementation((_limit, signal) => stalled(signal));
    work.media.mockImplementation((_actor, signal) => stalled(signal));
    work.account.mockImplementation((_limit, signal) => stalled(signal));
    const started = Date.now();
    const running = runCommunityMaintenance();
    await vi.advanceTimersByTimeAsync(40_000);
    const result = await running;
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(result).toMatchObject({ ok: false, stages: {
      retention: "deferred", notifications: "deferred", artworkMedia: "deferred", accountMedia: "deferred" } });
    for (const stage of Object.values(work)) expect(stage).toHaveBeenCalledOnce();
    expect(active).toBe(0);
    expect(maxActive).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues independent work after retention fails and exposes only safe stage enums", async () => {
    work.retention.mockRejectedValue(new Error("private backend detail"));
    const result = await runCommunityMaintenance();
    expect(result).toMatchObject({ ok: false, error: "maintenance_incomplete", passes: 10,
      stages: { retention: "unavailable", notifications: "completed", artworkMedia: "completed", accountMedia: "completed" } });
    expect(work.notifications).toHaveBeenCalledOnce();
    expect(work.media).toHaveBeenCalledTimes(10);
    expect(work.account).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("private backend detail");
  });
});
