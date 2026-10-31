import { createHash, timingSafeEqual } from "node:crypto";

import { runCommunityMaintenance } from "@/lib/community/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

/** Vercel supplies Authorization: Bearer CRON_SECRET for configured cron jobs. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.trim().length < 32) return json({ ok: false, error: "scheduler_unconfigured" }, 503);
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.length > 512 || !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  try {
    const result = await runCommunityMaintenance();
    if (!result.ok) console.error(`[community-maintenance] Maintenance incomplete: ${result.error}.`);
    return json(result, result.ok ? 200 : 503);
  } catch {
    console.error("[community-maintenance] Scheduled cleanup pass failed; durable work remains queued.");
    return json({ ok: false, error: "cleanup_unavailable" }, 503);
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}
