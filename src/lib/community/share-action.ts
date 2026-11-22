import type { Locale } from "@/i18n/routing";
import type { CommunityHeartAccess } from "./types";

export function communityShareAction({ locale, authenticated, verified, access, unlockedProductIds, productId, productSlug }: {
  locale: Locale; authenticated: boolean; verified: boolean; access: CommunityHeartAccess; unlockedProductIds: string[]; productId?: string; productSlug?: string;
}) {
  const next = `/${locale}/library/creations${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`;
  if (!authenticated) return { href: `/${locale}/login?returnTo=${encodeURIComponent(next)}`, label: "Log in to share your art" };
  if (!verified) return { href: `/${locale}/account`, label: "Verify your email to share" };
  if (!unlockedProductIds.length || (productId && !unlockedProductIds.includes(productId))) return { href: productSlug ? `/${locale}/products/${encodeURIComponent(productSlug)}#premium` : `/${locale}/unlock`, label: "Unlock a book to share your art" };
  if (access !== "member") return { href: `/${locale}/account`, label: "Review Coloring Club requirements" };
  return { href: next, label: "Share your art" };
}
