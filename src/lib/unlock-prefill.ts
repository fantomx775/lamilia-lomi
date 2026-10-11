import type { UnlockIntent } from "./unlock-intent";
import type { Locale } from "@/i18n/routing";

type BackendMode = "local" | "supabase";
type CurrentUnlockIntent = Pick<UnlockIntent, "productSlug" | "code"> & {
  locale: string;
};

export function selectUnlockPrefillCode(input: {
  currentIntent: CurrentUnlockIntent | null;
  locale: Locale;
  productSlug: string;
  backendMode: BackendMode;
  hasSupabaseUser: boolean;
  accountBoundResumeCode?: string;
}) {
  const currentIntent = input.currentIntent;
  const hasCurrentIntent =
    currentIntent?.locale === input.locale &&
    currentIntent?.productSlug === input.productSlug;

  if (hasCurrentIntent && currentIntent?.code) {
    return currentIntent.code;
  }

  if (input.backendMode === "supabase" && input.hasSupabaseUser) {
    return input.accountBoundResumeCode;
  }

  return hasCurrentIntent ? currentIntent?.code : undefined;
}
