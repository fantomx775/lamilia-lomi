import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { CommunityCreationManager } from "@/components/community/community-creation-manager";
import type { Locale } from "@/i18n/routing";
import { getCommunityFlags } from "@/lib/community-flags";
import { COMMUNITY_RULES_VERSION } from "@/lib/community/rules";
import { getMyCommunityProfile, listMyCommunityArtworks } from "@/lib/community/repository";
import { getCommunityActorForRequest } from "@/lib/community/session";
import { sanitizeReturnTo } from "@/lib/return-to";
import { getDemoSession } from "@/lib/session.server";
import { getProductByIdForRequest } from "@/lib/products-request";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "My Creations | LamiliaLomi",
  robots: { index: false, follow: false },
};

export default async function MyCreationsPage({ params, searchParams }: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const returnTo = sanitizeReturnTo(`/${locale}/library/creations`, locale);
  const actor = await getCommunityActorForRequest();
  if (!actor) redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);

  const flags = getCommunityFlags();
  const session = await getDemoSession();
  const profile = actor.emailVerified ? await getMyCommunityProfile() : null;
  const artworks = actor.emailVerified ? await listMyCommunityArtworks(50) : [];
  const unlockedIds = actor.emailVerified ? (session?.unlockedProductIds ?? actor.unlockedProductIds) : [];
  const products = (await Promise.all(unlockedIds.map(async (id) => {
    const product = await getProductByIdForRequest(id);
    if (!product || product.status !== "published") return null;
    return {
      id: product.id,
      slug: product.slug,
      title: product.translations.find((translation) => translation.locale === "en")?.title ?? product.slug,
    };
  }))).filter((product): product is NonNullable<typeof product> => Boolean(product));
  const activeMember = Boolean(profile?.isAdult && profile.adultAttestedAt && profile.optedInAt
    && !profile.participationRevokedAt && !profile.suspendedAt && profile.rulesVersion === COMMUNITY_RULES_VERSION);
  const preselectedProductId = typeof query.productId === "string" && products.some((item) => item.id === query.productId)
    ? query.productId
    : "";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8" data-testid="my-creations-page">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-[var(--color-muted)]">
        <Link className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" href={`/${locale}/library`}>My Library</Link>
        <span className="px-2" aria-hidden="true">/</span>
        <span aria-current="page">My Creations</span>
      </nav>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-[var(--color-terracotta)]">Your private submissions</p>
          <h1 className="mt-1 font-serif text-4xl font-semibold text-[var(--color-ink)]">My Creations</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">Only you can see your submission statuses and review reasons here.</p>
        </div>
        <Link className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" href={`/${locale}/account`}>
          Community settings
        </Link>
      </div>

      {!actor.emailVerified ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-5 text-sm leading-6 text-[var(--color-muted)]" data-testid="creations-unverified-state">
          Verify your email before viewing or managing Coloring Club submissions.
        </div>
      ) : (
        <CommunityCreationManager
          initialArtworks={artworks}
          products={products}
          uploadsEnabled={flags.uploadsEnabled}
          canSubmit={Boolean(flags.uploadsEnabled && activeMember)}
          canEdit={Boolean(flags.uploadsEnabled && activeMember)}
          canDelete={actor.emailVerified}
          communityMember={Boolean(profile)}
          guidelinesHref={`/${locale}/community-guidelines`}
          accountHref={`/${locale}/account`}
          libraryHref={`/${locale}/library`}
          preselectedProductId={preselectedProductId}
        />
      )}
    </div>
  );
}
