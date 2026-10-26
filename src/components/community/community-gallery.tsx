"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { CommunityAvatar } from "@/components/community/community-avatar";
import type { CommunityPage, CommunityPublicArtwork, CommunityPublicProductOption } from "@/lib/community/types";

const PAGE_SIZE = 24;

export function CommunityGallery({
  initialPage,
  products,
  initialAudience = "",
  initialProductId = "",
}: {
  initialPage: CommunityPage<CommunityPublicArtwork>;
  products: CommunityPublicProductOption[];
  initialAudience?: string;
  initialProductId?: string;
}) {
  const [audience, setAudience] = useState(initialAudience);
  const [productId, setProductId] = useState(initialProductId);
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [filterKey, setFilterKey] = useState(0);
  const requestGeneration = useRef(0);
  const filterController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!filterKey) return;
    const generation = ++requestGeneration.current;
    filterController.current?.abort();
    const controller = new AbortController();
    filterController.current = controller;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), sort: "latest" });
    if (audience) params.set("audience", audience);
    if (productId) params.set("productId", productId);
    fetch(`/api/community/artworks?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Gallery unavailable");
        return await response.json() as { ok: true } & CommunityPage<CommunityPublicArtwork>;
      })
      .then((nextPage) => { if (requestGeneration.current === generation) setPage(nextPage); })
      .catch((cause: unknown) => { if (requestGeneration.current === generation && !(cause instanceof DOMException && cause.name === "AbortError")) setError(true); })
      .finally(() => { if (requestGeneration.current === generation) setLoading(false); });
    return () => controller.abort();
  }, [filterKey, audience, productId]);

  function changeFilters(nextAudience: string, nextProductId: string) {
    requestGeneration.current += 1;
    filterController.current?.abort();
    const params = new URLSearchParams();
    if (nextAudience) params.set("audience", nextAudience);
    if (nextProductId) params.set("productId", nextProductId);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    setPage({ items: [], nextCursor: null });
    setLoading(true);
    setError(false);
    setAudience(nextAudience);
    setProductId(nextProductId);
    setFilterKey((key) => key + 1);
  }

  async function loadMore() {
    if (!page.nextCursor || loading) return;
    const generation = requestGeneration.current;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), sort: "latest", cursor: page.nextCursor });
    if (audience) params.set("audience", audience);
    if (productId) params.set("productId", productId);
    try {
      const response = await fetch(`/api/community/artworks?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Gallery unavailable");
      const nextPage = await response.json() as { ok: true } & CommunityPage<CommunityPublicArtwork>;
      if (requestGeneration.current === generation) setPage((current) => ({ items: [...current.items, ...nextPage.items], nextCursor: nextPage.nextCursor }));
    } catch {
      if (requestGeneration.current === generation) setError(true);
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }

  return <>
    <div className="mb-7 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-border)] bg-white/75 p-4" aria-label="Gallery filters">
      <label className="grid min-w-40 flex-1 gap-1.5 text-sm font-medium text-[var(--color-ink)]">
        Audience
        <select data-testid="community-gallery-audience-filter" className={selectClass} value={audience} onChange={(event) => changeFilters(event.target.value, productId)}>
          <option value="">All audiences</option><option value="kids">Kids</option><option value="adults">Adults</option>
        </select>
      </label>
      <label className="grid min-w-48 flex-[2] gap-1.5 text-sm font-medium text-[var(--color-ink)]">
        Book
        <select data-testid="community-gallery-product-filter" className={selectClass} value={productId} onChange={(event) => changeFilters(audience, event.target.value)}>
          <option value="">All books</option>{products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
        </select>
      </label>
      <label className="grid min-w-36 flex-1 gap-1.5 text-sm font-medium text-[var(--color-ink)]">
        Sort by
        <select data-testid="community-gallery-sort" className={selectClass} value="latest" disabled>
          <option value="latest">Newest first</option>
        </select>
      </label>
    </div>
    {loading && !page.items.length ? <p className="py-10 text-center text-sm text-[var(--color-muted)]" aria-live="polite">Loading approved artwork…</p> : error && !page.items.length ? <div className="rounded-xl border border-[var(--color-border)] bg-white/75 px-5 py-9 text-center" role="alert"><h2 className="font-serif text-xl font-semibold text-[var(--color-ink)]">The gallery could not be updated</h2><p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Please try again in a moment.</p><button type="button" onClick={() => { setLoading(true); setError(false); setFilterKey((key) => key + 1); }} className="mt-4 min-h-10 rounded-md border border-[var(--color-border)] bg-white px-4 text-sm font-semibold">Try again</button></div> : page.items.length ? <ul data-testid="community-artwork-grid" aria-busy={loading} className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
      {page.items.map((artwork) => <li key={artwork.id}><CommunityArtworkCard artwork={artwork} /></li>)}
    </ul> : <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-white/60 px-5 py-12 text-center" data-testid="community-gallery-empty-state">
      <h2 className="font-serif text-2xl font-semibold text-[var(--color-ink)]">No approved artwork here yet</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--color-muted)]">Try a different book or audience, or come back as more community creations are approved.</p>
      <Link className="mt-5 inline-flex min-h-10 items-center rounded-md border border-[var(--color-border)] px-4 text-sm font-medium hover:bg-[var(--color-blush)]" href="/en/products">Browse the books</Link>
    </div>}
    <div className="mt-8 flex justify-center">
      {page.nextCursor ? <button data-testid="community-gallery-load-more" type="button" disabled={loading} onClick={loadMore} className="min-h-11 rounded-md border border-[var(--color-border)] bg-white px-5 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] disabled:opacity-60">{loading ? "Loading…" : "Load more artwork"}</button> : page.items.length ? <p className="text-sm text-[var(--color-muted)]">You’ve reached the end of the gallery.</p> : null}
    </div>
  </>;
}

export function CommunityArtworkCard({ artwork }: { artwork: CommunityPublicArtwork }) {
  const detailHref = `/en/club/artworks/${artwork.id}`;
  return <article data-testid="community-artwork-card" className="h-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-sm">
    <Link href={detailHref} aria-label={`View artwork by @${artwork.creator.username}`} className="group relative block aspect-[4/5] overflow-hidden bg-[var(--color-bg-alt)] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--color-terracotta)]">
      <Image src={`/api/community/artworks/${artwork.id}/media`} alt={artwork.description ? `Coloring by @${artwork.creator.username}: ${artwork.description}` : `Coloring by @${artwork.creator.username}`} fill unoptimized loading="lazy" sizes="(max-width: 639px) 48vw, (max-width: 1023px) 46vw, 24vw" className="object-contain transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none" />
    </Link>
    <div className="grid gap-2 p-3 sm:gap-3 sm:p-4">
      {artwork.description ? <p className="line-clamp-2 min-h-[2.5rem] break-words text-sm leading-5 text-[var(--color-ink)]">{artwork.description}</p> : <p className="min-h-[2.5rem] text-sm text-[var(--color-muted)]">A coloring-club creation</p>}
      <div className="flex min-w-0 items-center gap-2">
        <Link href={`/en/club/creators/${encodeURIComponent(artwork.creator.username)}`} aria-label={`View @${artwork.creator.username}’s profile`} className="flex min-w-0 items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-[var(--color-terracotta)]">
          <CommunityAvatar username={artwork.creator.username} seed={artwork.creator.avatarSeed} className="size-8 text-xs" />
          <span className="truncate text-sm font-medium text-[var(--color-ink)]">@{artwork.creator.username}</span>
        </Link>
      </div>
      <div className="min-w-0 border-t border-[var(--color-border)] pt-2 text-xs leading-5 text-[var(--color-muted)]">
        <Link href={`/en/products/${encodeURIComponent(artwork.product.slug)}`} className="line-clamp-2 break-words hover:text-[var(--color-ink)]">{artwork.product.title}</Link>
        <time className="mt-1 block" dateTime={artwork.publishedAt}>{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(artwork.publishedAt))}</time>
      </div>
    </div>
  </article>;
}

const selectClass = "min-h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] disabled:opacity-70";
