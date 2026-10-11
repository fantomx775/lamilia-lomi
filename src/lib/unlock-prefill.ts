import type { UnlockIntent } from "./unlock-intent";

type BackendMode = "local" | "supabase";

export function selectUnlockPrefillCode(input: {
  currentIntent: Pick<UnlockIntent, "locale" | "productSlug" | "code"> | null;
  locale: string;
  productSlug: string;
  backendMode: BackendMode;
  hasSupabaseUser: boolean;
  accountBoundResumeCode?: string;
}) {
  const hasCurrentIntent =
    input.currentIntent?.locale === input.locale &&
    input.currentIntent.productSlug === input.productSlug;

  if (hasCurrentIntent && input.currentIntent.code) {
    return input.currentIntent.code;
  }

  if (input.backendMode === "supabase" && input.hasSupabaseUser) {
    return input.accountBoundResumeCode;
  }

  return hasCurrentIntent ? input.currentIntent.code : undefined;
}
