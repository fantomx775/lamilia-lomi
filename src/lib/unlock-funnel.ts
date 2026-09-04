import type { Locale } from "@/i18n/routing";

export const unlockFunnelStates = [
  "qr_entry",
  "product_context",
  "guest_auth",
  "verification_required",
  "code_entry",
  "redeeming",
  "unlocked",
  "library",
  "download_allowed",
  "denied",
] as const;

export type UnlockFunnelState = (typeof unlockFunnelStates)[number];

export type UnlockFunnelEvent =
  | { type: "product_validated" }
  | { type: "product_invalid" }
  | { type: "auth_required" }
  | { type: "authenticated"; verified: boolean }
  | { type: "verification_completed" }
  | { type: "code_submitted" }
  | { type: "redemption_succeeded"; alreadyUnlocked?: boolean }
  | { type: "redemption_failed" }
  | { type: "library_opened" }
  | { type: "download_authorized" }
  | { type: "download_denied" };

export type UnlockFunnelSnapshot = {
  state: UnlockFunnelState;
  locale: Locale;
  productSlug?: string;
};

export function transitionUnlockFunnel(
  snapshot: UnlockFunnelSnapshot,
  event: UnlockFunnelEvent,
): UnlockFunnelSnapshot {
  switch (event.type) {
    case "product_validated":
      return { ...snapshot, state: "product_context" };
    case "product_invalid":
      return { ...snapshot, state: "denied" };
    case "auth_required":
      return { ...snapshot, state: "guest_auth" };
    case "authenticated":
      return {
        ...snapshot,
        state: event.verified ? "code_entry" : "verification_required",
      };
    case "verification_completed":
      return { ...snapshot, state: "code_entry" };
    case "code_submitted":
      return { ...snapshot, state: "redeeming" };
    case "redemption_succeeded":
      return { ...snapshot, state: "unlocked" };
    case "redemption_failed":
      return { ...snapshot, state: "code_entry" };
    case "library_opened":
      return { ...snapshot, state: "library" };
    case "download_authorized":
      return { ...snapshot, state: "download_allowed" };
    case "download_denied":
      return { ...snapshot, state: "denied" };
  }
}

export function unlockOutcomeState(
  outcome: "unlocked" | "already_unlocked" | "invalid" | "verification_required",
): UnlockFunnelState {
  return outcome === "unlocked" || outcome === "already_unlocked"
    ? "unlocked"
    : outcome === "verification_required"
      ? "verification_required"
      : "code_entry";
}
