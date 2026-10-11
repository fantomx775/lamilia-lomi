import { randomBytes, randomUUID } from "node:crypto";

import { getCanonicalAppUrl } from "./config";
import { MAX_PREMIUM_CODE_BATCH_SIZE, normalizePremiumCode } from "./premium-code";
import type { PremiumCode, Product } from "./types";

export type NewPremiumCode = Pick<PremiumCode, "id" | "productId" | "code" | "active">;

export function createPremiumCodeBatch(input: {
  productId: string;
  count: number;
  existingCodes?: string[];
}): NewPremiumCode[] {
  if (
    !Number.isSafeInteger(input.count) ||
    input.count < 1 ||
    input.count > MAX_PREMIUM_CODE_BATCH_SIZE
  ) {
    throw new RangeError("Premium code batch size is outside the allowed range.");
  }

  const knownCodes = new Set((input.existingCodes ?? []).map(normalizePremiumCode));
  const generated: NewPremiumCode[] = [];
  const candidateLimit = input.count * 4;

  for (let attempt = 0; attempt < candidateLimit && generated.length < input.count; attempt += 1) {
    const code = formatGeneratedCode(randomBytes(16).toString("hex"));
    const normalized = normalizePremiumCode(code);

    if (knownCodes.has(normalized)) {
      continue;
    }

    knownCodes.add(normalized);
    generated.push({
      id: randomUUID(),
      productId: input.productId,
      code,
      active: true,
    });
  }

  if (generated.length !== input.count) {
    throw new Error("Could not generate a unique premium code batch.");
  }

  return generated;
}

export function exportPremiumCodesToCsv(product: Product, appUrl = getCanonicalAppUrl()) {
  const title = product.translations.find((translation) => translation.locale === "en")?.title ?? product.slug;
  const rows = [
    ["product_title", "product_slug", "premium_code", "status", "active", "redeemed_at", "qr_payload"],
    ...product.premiumCodes.map((code) => {
      const status = code.redeemedAt
        ? code.active ? "redeemed" : "redeemed_disabled"
        : code.active ? "unused" : "disabled";
      const qrPayload = code.active
        ? buildQrPayload(appUrl, product.slug, code.code)
        : "";

      return [
        title,
        product.slug,
        code.code,
        status,
        code.active ? "yes" : "no",
        code.redeemedAt ?? "",
        qrPayload,
      ];
    }),
  ];

  return `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

function formatGeneratedCode(hex: string) {
  const normalizedHex = hex.toUpperCase();
  const groups = normalizedHex.match(/.{4}/g);

  if (!groups || normalizedHex.length !== 32) {
    throw new Error("Generated premium code has an invalid format.");
  }

  return `LL-${groups.join("-")}`;
}

function buildQrPayload(appUrl: URL, slug: string, code: string) {
  const payload = new URL(`/api/unlock/en/${encodeURIComponent(slug)}`, appUrl);
  payload.searchParams.set("code", code);
  return payload.toString();
}

function escapeCsvCell(value: string) {
  const safeValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}
