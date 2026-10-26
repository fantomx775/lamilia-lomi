import { cache } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { CommunityAvatar } from "@/components/community/community-avatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { getCommunityFlags } from "@/lib/community-flags";
import { getCommunityPublicCreator } from "@/lib/community/repository";

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
    robots: { index: true, follow: true },
    openGraph: { title, description, type: "profile" },
  };
}

export default async function CreatorProfilePage({ params }: PageProps) {
  const { locale, username } = await params;
  if (locale !== "en" || !getCommunityFlags().publicEnabled) notFound();
  const creator = await getCreatorForRequest(username);
  if (!creator) notFound();

  return (
    <div data-testid="community-creator-page" className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <Card>
        <CardHeader className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <CommunityAvatar username={creator.username} seed={creator.avatarSeed} className="size-16 text-lg" />
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-[var(--color-terracotta)]">Coloring Club creator</p>
            <h1 className="mt-1 break-all font-serif text-3xl font-semibold text-[var(--color-ink)]">@{creator.username}</h1>
            <p className="mt-1 text-sm text-[var(--color-muted)]">Approved artwork shared by this community member.</p>
          </div>
        </CardHeader>
        <CardContent>
          {creator.artworks.length ? (
            <section aria-labelledby="creator-artworks-heading">
              <h2 id="creator-artworks-heading" className="mb-4 font-serif text-2xl font-semibold text-[var(--color-ink)]">Approved creations</h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {creator.artworks.map((artwork) => (
                  <li key={artwork.id}>
                    <Card className="h-full shadow-none">
                      <CardContent className="grid h-full content-start gap-3 p-3 sm:p-4">
                        <Link href={`/${locale}/club/artworks/${artwork.id}`} className="relative block aspect-[4/5] overflow-hidden rounded-lg bg-[var(--color-bg-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" aria-label={`View artwork${artwork.description ? `: ${artwork.description}` : ""}`}>
                          <Image src={`/api/community/artworks/${artwork.id}/media`} alt={artwork.description ? `Coloring by @${creator.username}: ${artwork.description}` : `Coloring by @${creator.username}`} fill unoptimized loading="lazy" sizes="(max-width: 639px) 90vw, (max-width: 1023px) 45vw, 30vw" className="object-cover" />
                        </Link>
                        <h3 className="line-clamp-2 break-words font-serif text-lg font-semibold text-[var(--color-ink)]">
                          <Link href={`/${locale}/club/artworks/${artwork.id}`} className="hover:underline">{artwork.description || `Artwork for ${artwork.product.title}`}</Link>
                        </h3>
                        <p className="text-sm text-[var(--color-muted)]">
                          From <Link className="font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" href={`/${locale}/products/${encodeURIComponent(artwork.product.slug)}`}>{artwork.product.title}</Link>
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
              <p className="mt-2">When this creator has work approved for sharing, it will appear here.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function privateMetadata(): Metadata {
  return { title: "Creator profile | Coloring Club", robots: { index: false, follow: false } };
}
