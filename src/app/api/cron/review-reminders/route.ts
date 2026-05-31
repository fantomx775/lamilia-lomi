import { NextResponse } from "next/server";

import { getResendClient } from "@/lib/email";
import { shouldSendReminder } from "@/lib/reminders";

export async function GET(request: Request) {
  const secret = request.headers.get("authorization")?.replace("Bearer ", "");

  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const due = shouldSendReminder({
    scheduledFor: new Date("2026-05-01T09:00:00.000Z"),
    status: "pending",
  });
  const resend = getResendClient();

  return NextResponse.json({
    ok: true,
    mode: resend ? "resend-ready" : "stub",
    dueReminders: due ? 1 : 0,
    sent: due && resend ? 1 : 0,
  });
}
