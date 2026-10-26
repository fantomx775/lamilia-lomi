import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { getBackendMode } from "@/lib/config";
import { getResendClient } from "@/lib/email";

import * as supabase from "./supabase-adapter";

const TEMPLATE_VERSION = "cc-status-2026-10-26-v1";
const FROM = "LamiliaLomi <hello@lamilialomi.com>";

/**
 * Sends only committed moderation outcomes. The outbox is authoritative; no
 * Resend key, lookup outage, or provider error can reverse a moderation write.
 */
export async function processCommunityModerationNotifications(limit = 10) {
  if (getBackendMode() !== "supabase") return { claimed: 0, sent: 0, suppressed: 0, retrying: 0 };
  const resend = getResendClient();
  if (!resend) return { claimed: 0, sent: 0, suppressed: 0, retrying: 0 };
  const fingerprintSecret = process.env.AUTH_RESUME_SECRET;
  if (!fingerprintSecret || fingerprintSecret.length < 32) return { claimed: 0, sent: 0, suppressed: 0, retrying: 0 };

  const leaseToken = randomUUID();
  const messages = await supabase.claimModerationEmailOutbox(leaseToken, Math.min(Math.max(limit, 1), 10));
  let sent = 0;
  let suppressed = 0;
  let retrying = 0;
  for (const item of messages) {
    try {
      const recipient = item.author_user_id ? await supabase.getModerationEmailRecipient(item.author_user_id) : null;
      if (!recipient) {
        if (await supabase.finishModerationEmailSend({ eventId: item.moderation_event_id, leaseToken, result: "suppressed" })) suppressed += 1;
        continue;
      }
      const message = buildStatusMessage(item.notification_type);
      const payloadFingerprint = createHmac("sha256", fingerprintSecret)
        .update(JSON.stringify({ to: recipient.toLowerCase(), from: FROM, subject: message.subject, text: message.text, version: TEMPLATE_VERSION }))
        .digest("hex");
      const prepared = await supabase.prepareModerationEmailSend(item.moderation_event_id, leaseToken, payloadFingerprint, TEMPLATE_VERSION);
      if (!prepared) continue;
      const result = await resend.emails.send({ from: FROM, to: [recipient], subject: message.subject, text: message.text }, {
        idempotencyKey: `community-moderation/${item.moderation_event_id}`,
      });
      if (result.error) {
        if (await supabase.finishModerationEmailSend({ eventId: item.moderation_event_id, leaseToken, result: "retry", errorCode: "provider_error" })) retrying += 1;
      } else if (result.data?.id) {
        if (await supabase.finishModerationEmailSend({ eventId: item.moderation_event_id, leaseToken, result: "sent", providerMessageId: result.data.id })) sent += 1;
      } else if (await supabase.finishModerationEmailSend({ eventId: item.moderation_event_id, leaseToken, result: "retry", errorCode: "provider_error" })) {
        retrying += 1;
      }
    } catch {
      try {
        if (await supabase.finishModerationEmailSend({ eventId: item.moderation_event_id, leaseToken, result: "retry", errorCode: "network_error" })) retrying += 1;
      } catch {
        // A live lease will expire for a later fenced retry. Do not log PII or provider details.
      }
    }
  }
  return { claimed: messages.length, sent, suppressed, retrying };
}

function buildStatusMessage(status: "approved" | "rejected") {
  const origin = safeSiteOrigin(process.env.NEXT_PUBLIC_APP_URL);
  const manageUrl = origin ? `${origin}/en/library/creations` : "";
  if (status === "approved") {
    return {
      subject: "Your Coloring Club artwork was approved",
      text: `Your Coloring Club artwork was approved and is now visible in the gallery.${manageUrl ? `\n\nView your creations: ${manageUrl}` : ""}`,
    };
  }
  return {
    subject: "Your Coloring Club artwork was reviewed",
    text: `Your Coloring Club artwork was not approved. You can review its status in My Creations.${manageUrl ? `\n\nView your creations: ${manageUrl}` : ""}`,
  };
}

function safeSiteOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1" ? url.origin : null;
  } catch { return null; }
}
