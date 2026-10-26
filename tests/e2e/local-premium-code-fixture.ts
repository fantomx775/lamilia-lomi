import fs from "node:fs";
import path from "node:path";

import { getSeedContentSnapshot } from "@/lib/local-content";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLoopbackPlaywrightTarget } from "./local-target";

const productSlug = "moon-garden-coloring-book";
const premiumCode = "LOMI-BOOK-2026";

/** Reset only the known demo seed code for one verified loopback test, then restore exact prior bytes. */
export async function resetLocalPremiumCodeFixture(baseURL: unknown): Promise<() => void> {
  if (!isLoopbackPlaywrightTarget(baseURL)) {
    throw new Error("The premium-code fixture may only be reset for a loopback test target.");
  }

  const releaseLock = await acquireLocalContentStoreLock();
  const contentStorePath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  const hadContentStore = fs.existsSync(contentStorePath);
  const originalContentStore = hadContentStore ? fs.readFileSync(contentStorePath) : undefined;

  try {
    const snapshot = hadContentStore
      ? JSON.parse(originalContentStore!.toString("utf8")) as { products?: Array<Record<string, unknown>> }
      : getSeedContentSnapshot() as unknown as { products: Array<Record<string, unknown>> };
    const product = snapshot.products?.find((item) => item.slug === productSlug);
    const codes = Array.isArray(product?.premiumCodes) ? product.premiumCodes as Array<Record<string, unknown>> : [];
    const code = codes.find((item) => item.code === premiumCode);
    if (!code || code.active !== true) {
      throw new Error("The expected active local premium-code fixture was not found.");
    }
    delete code.redeemedAt;
    delete code.redeemedBy;
    fs.mkdirSync(path.dirname(contentStorePath), { recursive: true });
    fs.writeFileSync(contentStorePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  } catch (error) {
    releaseLock();
    throw error;
  }

  let restored = false;
  return () => {
    if (restored) return;
    try {
      if (hadContentStore && originalContentStore) {
        fs.writeFileSync(contentStorePath, originalContentStore);
      } else if (fs.existsSync(contentStorePath)) {
        fs.rmSync(contentStorePath);
      }
    } finally {
      restored = true;
      releaseLock();
    }
  };
}
