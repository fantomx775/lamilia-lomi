import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { after } from "next/server";

import { getBackendMode } from "@/lib/config";
import { getResendClient } from "@/lib/email";

import * as supabase from "./supabase-adapter";

const LEGACY_TEMPLATE_VERSION = "cc-status-2026-10-26-v2";
const TEMPLATE_VERSION = "cc-moderation-2026-11-16-v1";
const FROM = "LamiliaLomi <hello@lamilialomi.com>";

type NotificationCounts = { claimed: number; sent: number; suppressed: number; retrying: number };
export type CommunityNotificationResult = NotificationCounts & (
  | { status: "ready" }
  | { status: "disabled"; reason: "local_backend" }
  | { status: "unconfigured"; reason: "email_provider" | "fingerprint_secret" | "admin_recipient" }
);
const emptyCounts: NotificationCounts = { claimed: 0, sent: 0, suppressed: 0, retrying: 0 };

export function dispatchCommunityNotificationsAfterResponse() {
  if (getBackendMode() !== "supabase") return;
  after(async () => {
    try {
      const result = await processCommunityModerationNotifications(3, AbortSignal.timeout(10_000));
      if (result.status === "unconfigured") {
        console.error("[community-notification] Dispatcher is unconfigured:", result.reason);
      }
    } catch {
      console.error("[community-notification] Email remains queued for a later retry.");
    }
  });
}

/**
 * Sends only committed moderation outcomes. The outbox is authoritative; no
 * Resend key, lookup outage, or provider error can reverse a moderation write.
 */
export async function processCommunityModerationNotifications(limit = 10, signal?: AbortSignal): Promise<CommunityNotificationResult> {
  signal?.throwIfAborted();
  if (getBackendMode() !== "supabase") return { ...emptyCounts, status: "disabled", reason: "local_backend" };
  const resend = getResendClient();
  if (!resend) return { ...emptyCounts, status: "unconfigured", reason: "email_provider" };
  const fingerprintSecret = process.env.AUTH_RESUME_SECRET;
  if (!fingerprintSecret || fingerprintSecret.length < 32) return { ...emptyCounts, status: "unconfigured", reason: "fingerprint_secret" };
  const adminRecipient = process.env.COLORING_CLUB_ADMIN_EMAIL?.trim();
  if (!adminRecipient) return { ...emptyCounts, status: "unconfigured", reason: "admin_recipient" };

  const leaseToken = randomUUID();
  const messages = await supabase.claimModerationEmailOutbox(leaseToken, Math.min(Math.max(limit, 1), 10), signal);
  let sent = 0;
  let suppressed = 0;
  let retrying = 0;
  for (const item of messages) {
    signal?.throwIfAborted();
    try {
      const recipient = item.notification_type === "admin_pending"
        ? adminRecipient
        : item.author_user_id ? await supabase.getModerationEmailRecipient(item.author_user_id, signal) : null;
      if (!recipient) {
        if (await supabase.finishModerationEmailSend({ eventId: item.moderation_event_id, leaseToken, result: "suppressed" }, signal)) suppressed += 1;
        continue;
      }
      // Existing retries must keep the exact payload already prepared for Resend.
      const legacy = item.template_version === LEGACY_TEMPLATE_VERSION && item.notification_type !== "admin_pending";
      const version = legacy ? LEGACY_TEMPLATE_VERSION : TEMPLATE_VERSION;
      const message = buildModerationMessage(item.notification_type, legacy);
      const payloadFingerprint = createHmac("sha256", fingerprintSecret)
        .update(JSON.stringify({ to: recipient.toLowerCase(), from: FROM, ...message, version }))
        .digest("hex");
      const prepared = await supabase.prepareModerationEmailSend(item.moderation_event_id, leaseToken, payloadFingerprint, version, signal);
      if (!prepared) continue;
      signal?.throwIfAborted();
      // Resend 6 forwards request options through post() to native fetch. Keep
      // the cancellation regression against the actual SDK, whose public
      // PostOptions type currently omits the supported RequestInit.signal.
      const sendOptions = {
        idempotencyKey: `community-moderation/${item.moderation_event_id}`,
        ...(signal ? { signal } : {}),
      };
      const result = await resend.emails.send({ from: FROM, to: [recipient], ...message }, sendOptions);
      signal?.throwIfAborted();
      if (result.error) {
        if (await supabase.finishModerationEmailSend({ eventId: item.moderation_event_id, leaseToken, result: "retry", errorCode: "provider_error" }, signal)) retrying += 1;
      } else if (result.data?.id) {
        if (await supabase.finishModerationEmailSend({ eventId: item.moderation_event_id, leaseToken, result: "sent", providerMessageId: result.data.id }, signal)) sent += 1;
      } else if (await supabase.finishModerationEmailSend({ eventId: item.moderation_event_id, leaseToken, result: "retry", errorCode: "provider_error" }, signal)) {
        retrying += 1;
      }
    } catch {
      // An aborted send may have reached the provider. Keep its fenced lease
      // and frozen payload/key; do not start another write after the deadline.
      signal?.throwIfAborted();
      try {
        if (await supabase.finishModerationEmailSend({ eventId: item.moderation_event_id, leaseToken, result: "retry", errorCode: "network_error" }, signal)) retrying += 1;
      } catch {
        // A live lease will expire for a later fenced retry. Do not log PII or provider details.
      }
    }
  }
  signal?.throwIfAborted();
  return { status: "ready", claimed: messages.length, sent, suppressed, retrying };
}

function buildModerationMessage(status: "approved" | "rejected" | "admin_pending", legacy: boolean) {
  const origin = safeSiteOrigin(process.env.NEXT_PUBLIC_APP_URL);
  const pending = status === "admin_pending";
  const subject = pending
    ? "Coloring Club artwork is ready for review"
    : status === "approved" ? "Your Coloring Club artwork was approved" : "Your Coloring Club artwork was reviewed";
  const detail = pending
    ? "A reader submitted artwork or updated its description. Open the moderation queue to review it."
    : status === "approved"
      ? "Your Coloring Club artwork was approved. You can review its status in My Creations."
      : "Your Coloring Club artwork was not approved. You can review its status in My Creations.";
  const action = pending ? "Open moderation queue" : "View your creations";
  const path = pending ? "/admin/community" : "/en/library/creations";
  if (legacy) return { subject, text: `${detail}${origin ? `\n\n${action}: ${origin}${path}` : ""}` };

  const url = new URL(path, origin ?? "https://www.lamilialomi.com").href;
  return {
    subject,
    text: `${detail}\n\n${action}: ${url}`,
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#f8f5ef;color:#273d34;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="padding:28px;background:#fff;border:1px solid #e4ddd2;border-radius:16px">
<p style="margin:0 0 16px;font-family:Georgia,serif;font-size:21px">LamiliaLomi · Coloring Club</p>
<h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 12px">${subject}</h1>
<p style="line-height:1.6;margin:0 0 24px">${detail}</p>
<a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#344e42;color:#fff;text-decoration:none">${action}</a>
</div></div></body></html>`,
  };
}

function safeSiteOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1" ? url.origin : null;
  } catch { return null; }
}
