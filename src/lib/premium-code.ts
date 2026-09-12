export const MAX_PREMIUM_CODE_LENGTH = 128;

export function normalizePremiumCode(code: string | null | undefined) {
  return (code ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-")
    .toUpperCase();
}

export function normalizePremiumCodeForRequest(code: string | null | undefined) {
  const normalized = normalizePremiumCode(code);

  return normalized.length <= MAX_PREMIUM_CODE_LENGTH ? normalized : "";
}

export type PremiumCodeValidationIssue = {
  index: number;
  reason: "required" | "too_long" | "duplicate";
};

export function validatePremiumCodeEntries(
  entries: ReadonlyArray<{ code: string; removed?: boolean }>,
): PremiumCodeValidationIssue[] {
  const issues: PremiumCodeValidationIssue[] = [];
  const indexesByCode = new Map<string, number[]>();

  entries.forEach((entry, index) => {
    if (entry.removed) {
      return;
    }

    const normalized = normalizePremiumCode(entry.code);
    if (!normalized) {
      issues.push({ index, reason: "required" });
      return;
    }

    if (normalized.length > MAX_PREMIUM_CODE_LENGTH) {
      issues.push({ index, reason: "too_long" });
      return;
    }

    const indexes = indexesByCode.get(normalized) ?? [];
    indexes.push(index);
    indexesByCode.set(normalized, indexes);
  });

  for (const indexes of indexesByCode.values()) {
    if (indexes.length > 1) {
      indexes.forEach((index) => issues.push({ index, reason: "duplicate" }));
    }
  }

  return issues;
}
