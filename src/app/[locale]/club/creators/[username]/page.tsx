import { cache } from "react";
import { communityArtworkMediaUrl, communityArtworkMediaSrcSet } from "@/lib/community/media-urls";
import { NavigationLink } from "@/components/navigation-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { CommunityArtworkReport } from "@/components/community/community-artwork-report";
import { CommunityAvatar } from "@/components/community/community-avatar";
import { CommunityHeartControl } from "@/components/community/community-heart-control";
import { Card, CardContent } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { getCommunityFlags } from "@/lib/community-flags";
import { getCommunityPublicAvatarUrl } from "@/lib/community/avatar-repository";
import { getCommunityHeartContext, getCommunityPublicCreator } from "@/lib/community/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ locale: Locale; username: string }>;
};

const getCreatorForRequest = cache((username: string) => getCommunityPublicCreator(username));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, username } = await params;
  if (locale !== "en" || !getCommunityFlags().publicEnabled) return privateMetadata();
  const creator = await getCreatorForRequest(username);
  if (!creator) return privateMetadata();
  const title = `@${creator.username} | Coloring Club`;
  const description = `Approved Coloring Club artwork shared by @${creator.username}.`;
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/club/creators/${encodeURIComponent(creator.username)}` },
    robots: { index: creator.artworks.length > 0, follow: true },
    openGraph: { title, description, type: "profile" },
  };
}

export default async function CreatorProfilePage({ params }: PageProps) {
  const { locale, username } = await params;
  if (locale !== "en" || !getCommunityFlags().publicEnabled) notFound();
  const heartContext = await getCommunityHeartContext();
  const creator = await getCommunityPublicCreator(username, heartContext.access === "member" ? heartContext.actor : undefined);
  if (!creator) notFound();
  const photoSrc = await getCommunityPublicAvatarUrl(creator.username);

  return (
    <div data-testid="community-creator-page" className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6 flex min-w-0 items-center gap-4">
        <CommunityAvatar username={creator.username} seed={creator.avatarSeed} photoSrc={photoSrc} className="size-16 shrink-0 text-lg sm:size-20" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-terracotta)]">Coloring Club creator</p>
          <h1 className="mt-1 wrap-anywhere font-serif text-3xl font-semibold text-[var(--color-ink)]">@{creator.username}</h1>
        </div>
      </header>
      {photoSrc ? <CommunityArtworkReport artworkId={photoSrc.split("/").pop()!} subject="avatar" access={heartContext.access} returnTo={`/${locale}/club/creators/${encodeURIComponent(creator.username)}`} /> : null}
      {creator.artworks.length ? (
        <section aria-labelledby="creator-artworks-heading">
          <h2 id="creator-artworks-heading" className="mb-4 font-serif text-2xl font-semibold text-[var(--color-ink)]">Approved creations</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creator.artworks.map((artwork) => (
              <li key={artwork.id}>
                <Card className="h-full shadow-none">
                  <CardContent className="grid h-full content-start gap-3 p-3 sm:p-4">
                    <div className="relative">
                      <NavigationLink pendingLabel="Opening page" href={`/${locale}/club/artworks/${artwork.id}`} className="relative block aspect-[4/5] overflow-hidden rounded-lg bg-[var(--color-bg-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" aria-label={`View artwork${artwork.description ? `: ${artwork.description}` : ""}`}>
                        {/* Authenticated responsive variants, without a public cache. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={communityArtworkMediaUrl(artwork.id, 480)} srcSet={communityArtworkMediaSrcSet(artwork.id, artwork.imageDimensions)} alt={artwork.description ? `Coloring by @${creator.username}: ${artwork.description}` : `Coloring by @${creator.username}`} loading="lazy" sizes="(max-width: 639px) 90vw, (max-width: 1023px) 45vw, 30vw" className="absolute inset-0 size-full object-contain" />
                      </NavigationLink>
                      <div className="absolute bottom-2 right-2"><CommunityHeartControl artworkId={artwork.id} likesCount={artwork.likesCount} likedByMe={artwork.likedByMe} access={heartContext.access} returnTo={`/${locale}/club/creators/${encodeURIComponent(creator.username)}`} compact /></div>
                    </div>
                    <h3 className="line-clamp-2 break-words font-serif text-lg font-semibold text-[var(--color-ink)]">
                      <NavigationLink pendingLabel="Opening page" href={`/${locale}/club/artworks/${artwork.id}`} className="hover:underline">{artwork.description || `Artwork for ${artwork.product.title}`}</NavigationLink>
                    </h3>
                    <p className="text-sm text-[var(--color-muted)]">
                      From <NavigationLink pendingLabel="Opening page" className="font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" href={`/${locale}/products/${encodeURIComponent(artwork.product.slug)}`}>{artwork.product.title}</NavigationLink>
                    </p>
                    <time className="text-xs text-[var(--color-muted)]" dateTime={artwork.publishedAt}>
                      Shared {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(artwork.publishedAt))}
                    </time>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-alt)] p-6 text-sm leading-6 text-[var(--color-muted)]" data-testid="creator-empty-state">
          <h2 className="font-serif text-xl font-semibold text-[var(--color-ink)]">No approved creations yet</h2>
          <p className="mt-2">New creations appear here after review.</p>
          <NavigationLink pendingLabel="Opening page" className="mt-3 inline-flex min-h-11 items-center font-medium text-[var(--color-ink)] underline underline-offset-4" href={`/${locale}/club`}>Browse Coloring Club</NavigationLink>
        </div>
      )}
    </div>
  );
}

function privateMetadata(): Metadata {
  return { title: "Creator profile | Coloring Club", robots: { index: false, follow: false } };
}
