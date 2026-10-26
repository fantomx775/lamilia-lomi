import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CommunityAvatar } from "@/components/community/community-avatar";
import { CommunityHeartControl } from "@/components/community/community-heart-control";
import { CommunityArtworkReport } from "@/components/community/community-artwork-report";
import { getCommunityFlags } from "@/lib/community-flags";
import { getCommunityHeartContext, getCommunityPublicArtwork } from "@/lib/community/repository";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ locale: Locale; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  if (locale !== "en" || !getCommunityFlags().publicEnabled) return privateMetadata();
  const artwork = await getCommunityPublicArtwork(id);
  if (!artwork) return privateMetadata();
  const title = `${artwork.description || `Coloring by @${artwork.creator.username}`} | Coloring Club`;
  const description = `A community coloring by @${artwork.creator.username}, from ${artwork.product.title}.`;
  return {
    title,
    description,
    alternates: { canonical: `/en/club/artworks/${artwork.id}` },
    robots: { index: true, follow: true },
    openGraph: { title, description, type: "article", images: [`/api/community/artworks/${artwork.id}/media`] },
  };
}

export default async function CommunityArtworkPage({ params }: Props) {
  const { locale, id } = await params;
  if (locale !== "en" || !getCommunityFlags().publicEnabled) notFound();
  const heartContext = await getCommunityHeartContext();
  const artwork = await getCommunityPublicArtwork(id, heartContext.access === "member" ? heartContext.actor : undefined);
  if (!artwork) notFound();
  return <div data-testid="community-artwork-detail" className="mx-auto min-h-[60vh] max-w-7xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
    <Link href="/en/club" className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">← Back to Coloring Club</Link>
    <div className="mt-5 grid gap-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)] lg:gap-10">
      <div className="relative min-h-[24rem] aspect-[4/5] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-alt)] sm:aspect-[5/4] lg:aspect-[4/5]">
        <Image data-testid="community-artwork-media" src={`/api/community/artworks/${artwork.id}/media`} alt={artwork.description ? `Coloring by @${artwork.creator.username}: ${artwork.description}` : `Coloring by @${artwork.creator.username}`} fill priority unoptimized sizes="(min-width: 1024px) 65vw, 100vw" className="object-contain" />
      </div>
      <aside className="self-start rounded-2xl border border-[var(--color-border)] bg-white/85 p-5 sm:p-7">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-terracotta)]">Community artwork</p>
        <h1 className="mt-3 break-words font-serif text-3xl font-semibold text-[var(--color-ink)]">{artwork.description || `Coloring by @${artwork.creator.username}`}</h1>
        <div className="mt-6 flex items-center gap-3">
          <CommunityAvatar username={artwork.creator.username} seed={artwork.creator.avatarSeed} className="size-12" />
          <div><p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Colored by</p><Link data-testid="community-artwork-creator" href={`/en/club/creators/${encodeURIComponent(artwork.creator.username)}`} className="font-semibold text-[var(--color-ink)] underline underline-offset-4">@{artwork.creator.username}</Link></div>
        </div>
        <time className="mt-5 block text-sm text-[var(--color-muted)]" dateTime={artwork.publishedAt}>Shared {new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date(artwork.publishedAt))}</time>
        <div className="mt-5"><CommunityHeartControl artworkId={artwork.id} likesCount={artwork.likesCount} likedByMe={artwork.likedByMe} access={heartContext.access} returnTo={`/en/club/artworks/${artwork.id}`} /></div>
        <CommunityArtworkReport artworkId={artwork.id} access={heartContext.access} returnTo={`/en/club/artworks/${artwork.id}`} />
        <div className="mt-7 border-t border-[var(--color-border)] pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">From this book</p>
          <Link data-testid="community-artwork-book" href={`/en/products/${encodeURIComponent(artwork.product.slug)}`} className="mt-2 block rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-alt)] p-4 hover:border-[var(--color-terracotta)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">
            <span className="block font-serif text-xl font-semibold text-[var(--color-ink)]">{artwork.product.title}</span>
            <span className="mt-1 block text-sm text-[var(--color-muted)]">{artwork.product.audience === "kids" ? "For kids" : "For adults"}</span>
          </Link>
        </div>
        {getCommunityFlags().uploadsEnabled ? <Link data-testid="community-artwork-share" href="/en/library/creations" className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[var(--color-terracotta)] px-5 text-sm font-semibold text-white hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">Share your art</Link> : null}
      </aside>
    </div>
  </div>;
}

function privateMetadata(): Metadata { return { title: "Coloring Club artwork", robots: { index: false, follow: false } }; }
