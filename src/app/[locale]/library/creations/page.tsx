import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { getCommunityFlags } from "@/lib/community-flags";
import { getMyCommunityProfile, listMyCommunityArtworks } from "@/lib/community/repository";
import { getCommunityActorForRequest } from "@/lib/community/session";
import { sanitizeReturnTo } from "@/lib/return-to";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "My Creations | LamiliaLomi",
  robots: { index: false, follow: false },
};

export default async function MyCreationsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const returnTo = sanitizeReturnTo(`/${locale}/library/creations`, locale);
  const actor = await getCommunityActorForRequest();
  if (!actor) redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);

  const flags = getCommunityFlags();
  const profile = actor.emailVerified ? await getMyCommunityProfile() : null;
  const artworks = actor.emailVerified ? await listMyCommunityArtworks(50) : [];

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
        <Card data-testid="creations-unverified-state">
          <CardHeader><h2 className="font-serif text-2xl font-semibold">Verify your email</h2></CardHeader>
          <CardContent className="text-sm leading-6 text-[var(--color-muted)]">Verify your email before viewing or managing Coloring Club submissions.</CardContent>
        </Card>
      ) : artworks.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {artworks.map((artwork) => (
            <li key={artwork.id}>
              <Card className="h-full shadow-none" data-testid="my-creation-item">
                <CardContent className="grid gap-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-terracotta)]">{statusLabel(artwork.status)}</p>
                      <h2 className="mt-1 break-words font-serif text-xl font-semibold text-[var(--color-ink)]">{artwork.product.title}</h2>
                    </div>
                    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-alt)] px-3 py-1 text-xs text-[var(--color-ink)]">Revision {artwork.revision}</span>
                  </div>
                  <p className="break-words text-sm leading-6 text-[var(--color-muted)]">{artwork.description || "No description added."}</p>
                  <p className="text-xs text-[var(--color-muted)]">Updated {formatDate(artwork.updatedAt)}</p>
                  {artwork.rejectionReason ? (
                    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-alt)] p-3">
                      <h3 className="text-sm font-semibold text-[var(--color-ink)]">Private review reason</h3>
                      <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{artwork.rejectionReason}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <Card data-testid="my-creations-empty-state">
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold text-[var(--color-ink)]">No creations yet</h2>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm leading-6 text-[var(--color-muted)]">
            <p>{profile ? "Your shared creations and private review status will appear here." : "Join the Coloring Club to create a public username and manage your submissions."}</p>
            {!profile ? <Link className="font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" href={`/${locale}/account`}>Go to community settings</Link> : null}
            {profile && !flags.uploadsEnabled ? <p>New submissions are currently unavailable.</p> : null}
            {profile ? <Link className="font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" href={`/${locale}/library`}>Open My Library</Link> : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function statusLabel(status: string) {
  switch (status) {
    case "approved": return "Approved · visible publicly";
    case "pending": return "Pending review · private";
    case "rejected": return "Rejected · private";
    case "removed": return "Removed · private";
    default: return "Private submission";
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}
