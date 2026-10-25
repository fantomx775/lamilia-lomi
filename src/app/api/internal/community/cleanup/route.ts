import { createHash, timingSafeEqual } from "node:crypto";

import { processCommunityArtworkCleanup } from "@/lib/community/repository";

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
    // Each pass claims up to ten new rows with SQL/file-backed fencing. Failed
    // deletions retain their durable lease and retry on a later invocation.
    // Run independently of public/upload flags so pausing the club cannot stop cleanup.
    for (let pass = 0; pass < 10; pass++) await processCommunityArtworkCleanup();
    return json({ ok: true, passes: 10 });
  } catch {
    console.error("[community-maintenance] Scheduled cleanup pass failed; durable work remains queued.");
    return json({ ok: false, error: "cleanup_unavailable" }, 503);
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}
