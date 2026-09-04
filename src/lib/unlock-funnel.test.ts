import { describe, expect, it } from "vitest";

import {
  transitionUnlockFunnel,
  unlockOutcomeState,
  type UnlockFunnelSnapshot,
} from "./unlock-funnel";

describe("QR unlock funnel state machine", () => {
  it("models the happy path from QR entry to authorized download", () => {
    let snapshot: UnlockFunnelSnapshot = {
      state: "qr_entry",
      locale: "pl",
      productSlug: "moon-garden-coloring-book",
    };

    snapshot = transitionUnlockFunnel(snapshot, { type: "product_validated" });
    snapshot = transitionUnlockFunnel(snapshot, { type: "auth_required" });
    snapshot = transitionUnlockFunnel(snapshot, { type: "authenticated", verified: true });
    snapshot = transitionUnlockFunnel(snapshot, { type: "code_submitted" });
    snapshot = transitionUnlockFunnel(snapshot, { type: "redemption_succeeded" });
    snapshot = transitionUnlockFunnel(snapshot, { type: "library_opened" });
    snapshot = transitionUnlockFunnel(snapshot, { type: "download_authorized" });

    expect(snapshot).toMatchObject({ state: "download_allowed", locale: "pl" });
  });

  it("keeps invalid products and failed redemption in controlled denial/input states", () => {
    const invalid = transitionUnlockFunnel(
      { state: "qr_entry", locale: "en" },
      { type: "product_invalid" },
    );
    const retry = transitionUnlockFunnel(
      { state: "redeeming", locale: "en" },
      { type: "redemption_failed" },
    );

    expect(invalid.state).toBe("denied");
    expect(retry.state).toBe("code_entry");
    expect(unlockOutcomeState("already_unlocked")).toBe("unlocked");
    expect(unlockOutcomeState("verification_required")).toBe("verification_required");
  });
});
