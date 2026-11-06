import "server-only";

import {
  processCommunityAccountMediaCleanup,
  processCommunityArtworkCleanup,
  processCommunityReportRetention,
} from "./repository";
import { processCommunityModerationNotifications } from "./notifications";

// Reserve independent time for every queue, leaving 20 seconds inside the
// route's 60-second platform limit for scheduling/response overhead.
export const COMMUNITY_MAINTENANCE_BUDGET_MS = {
  retention: 5_000,
  notifications: 10_000,
  artworkMedia: 15_000,
  accountMedia: 10_000,
} as const;

type StageResult<T> = { status: "completed"; value: T } | { status: "deferred" | "unavailable" };

/** Await the canceled I/O itself; never race a still-running mutation. */
async function boundedStage<T>(milliseconds: number, run: (signal: AbortSignal) => Promise<T>): Promise<StageResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Community maintenance stage deadline.")), milliseconds);
  try {
    const value = await run(controller.signal);
    controller.signal.throwIfAborted();
    return { status: "completed", value };
  } catch {
    return { status: controller.signal.aborted ? "deferred" : "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function runCommunityMaintenance() {
  // Privacy retention and outbox attempts are independent of provider deletes.
  const retention = await boundedStage(COMMUNITY_MAINTENANCE_BUDGET_MS.retention,
    (signal) => processCommunityReportRetention(signal));
  const notificationStage = await boundedStage(COMMUNITY_MAINTENANCE_BUDGET_MS.notifications,
    (signal) => processCommunityModerationNotifications(10, signal));
  let passes = 0;
  const artworkMedia = await boundedStage(COMMUNITY_MAINTENANCE_BUDGET_MS.artworkMedia, async (signal) => {
    for (; passes < 10; passes++) {
      signal.throwIfAborted();
      await processCommunityArtworkCleanup(undefined, signal);
    }
  });
  const accountMedia = await boundedStage(COMMUNITY_MAINTENANCE_BUDGET_MS.accountMedia,
    (signal) => processCommunityAccountMediaCleanup(10, signal));
  const notifications = notificationStage.status === "completed" ? notificationStage.value : undefined;
  const stages = {
    retention: retention.status,
    notifications: notificationStage.status,
    artworkMedia: artworkMedia.status,
    accountMedia: accountMedia.status,
  };
  if (notifications?.status === "unconfigured") {
    return { ok: false as const, error: "notifications_unconfigured", passes, stages, notifications };
  }
  if (Object.values(stages).some((status) => status !== "completed")) {
    return { ok: false as const, error: "maintenance_incomplete", passes, stages, ...(notifications ? { notifications } : {}) };
  }
  return { ok: true as const, passes, stages, notifications };
}
