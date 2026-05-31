import { describe, expect, it } from "vitest";

import { scheduleReviewReminder, shouldSendReminder } from "./reminders";

describe("review reminders", () => {
  it("schedules one reminder using product delay", () => {
    expect(
      scheduleReviewReminder({
        unlockedAt: new Date("2026-05-01T09:00:00.000Z"),
        delayDays: 14,
      }).toISOString(),
    ).toBe("2026-05-15T09:00:00.000Z");
  });

  it("sends only pending due reminders", () => {
    expect(
      shouldSendReminder({
        scheduledFor: new Date("2026-05-30T09:00:00.000Z"),
        status: "pending",
        now: new Date("2026-05-31T09:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      shouldSendReminder({
        scheduledFor: new Date("2026-06-01T09:00:00.000Z"),
        status: "pending",
        now: new Date("2026-05-31T09:00:00.000Z"),
      }),
    ).toBe(false);
  });
});
