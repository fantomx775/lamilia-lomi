import type { Metadata } from "next";
import { NavigationLink } from "@/components/navigation-link";
import { notFound } from "next/navigation";

import { getDemoSession } from "@/lib/session.server";
import { communityShareAction } from "@/lib/community/share-action";
import { CommunityGallery } from "@/components/community/community-gallery";
import { getCommunityFlags } from "@/lib/community-flags";
import { getCommunityHeartContext, listCommunityPublicArtworks, listCommunityPublicProductOptions } from "@/lib/community/repository";
import type { CommunityAudience } from "@/lib/community/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== "en" || !getCommunityFlags().publicEnabled) return { title: "Coloring Club", robots: { index: false, follow: false } };
  return {
    title: "Coloring Club",
    description: "Discover approved coloring shared by the LamiliaLomi community.",
    alternates: { canonical: "/en/club" },
    openGraph: { title: "Coloring Club | LamiliaLomi", description: "Discover approved coloring shared by the LamiliaLomi community.", type: "website" },
  };
}

export default async function ColoringClubPage({ params, searchParams }: Props) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  if (locale !== "en" || !getCommunityFlags().publicEnabled) notFound();
  const audienceValue = one(query.audience);
  const requestedProductId = one(query.productId);
  const sortValue = one(query.sort);
  const sort = sortValue === "popular" ? "popular" : "latest";
  const [heartContext, products, session] = await Promise.all([getCommunityHeartContext(), listCommunityPublicProductOptions(), getCommunityFlags().uploadsEnabled ? getDemoSession() : Promise.resolve(null)]);
  const productId = requestedProductId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedProductId)
    && products.some((product) => product.id.toLowerCase() === requestedProductId.toLowerCase())
    ? requestedProductId.toLowerCase()
    : undefined;
  const initialPage = await listCommunityPublicArtworks({
    audience: audienceValue === "kids" || audienceValue === "adults" ? audienceValue as CommunityAudience : undefined,
    productId,
    sort,
    limit: 24,
    viewer: heartContext.access === "member" ? heartContext.actor : undefined,
  });
  const uploadsEnabled = getCommunityFlags().uploadsEnabled;
  const shareAction = communityShareAction({ locale: "en", authenticated: Boolean(session), verified: Boolean(session?.emailVerified), access: heartContext.access, unlockedProductIds: session?.unlockedProductIds ?? [], productId, productSlug: products.find((item) => item.id === productId)?.slug });
  return <div className="mx-auto min-h-[60vh] max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8" data-testid="community-gallery-page">
    <div className="mb-7 grid gap-5 rounded-2xl border border-[var(--color-border)] bg-[linear-gradient(135deg,var(--color-bg-alt),white)] p-6 sm:p-9 lg:grid-cols-[1fr_auto] lg:items-end">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--color-terracotta)]">Coloring Club</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold leading-tight text-[var(--color-ink)] sm:text-5xl">Coloring, shared with care</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--color-muted)]">Explore approved pages colored by our community. Each creation is shared by its artist and reviewed before it appears here.</p>
      </div>
      {uploadsEnabled ? <NavigationLink pendingLabel="Opening page" data-testid="community-gallery-share" href={shareAction.href} className="inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--color-terracotta)] px-5 text-sm font-semibold text-white hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">{shareAction.label}</NavigationLink> : null}
      {uploadsEnabled ? <p className="text-sm leading-6 text-[var(--color-muted)] lg:col-span-2">Sharing needs an account with a verified email, current Coloring Club participation requirements, and an unlocked book. Artwork is reviewed before it appears publicly.</p> : null}
    </div>
    <CommunityGallery initialPage={initialPage} products={products} initialAudience={audienceValue === "kids" || audienceValue === "adults" ? audienceValue : ""} initialProductId={productId ?? ""} initialSort={sort} heartAccess={heartContext.access} />
  </div>;
}

function one(value: string | string[] | undefined) { return Array.isArray(value) ? undefined : value; }
