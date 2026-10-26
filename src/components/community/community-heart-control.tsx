"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { useRef, useState } from "react";

import type { CommunityHeartAccess } from "@/lib/community/types";

type Props = {
  artworkId: string;
  likesCount: number;
  likedByMe: boolean;
  access: CommunityHeartAccess;
  returnTo?: string;
  compact?: boolean;
};

export function CommunityHeartControl({ artworkId, likesCount, likedByMe, access, returnTo = "/en/club", compact = false }: Props) {
  const [liked, setLiked] = useState(likedByMe);
  const [count, setCount] = useState(likesCount);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);

  async function toggle() {
    if (busy.current || access !== "member") return;
    busy.current = true;
    setPending(true);
    setError(false);
    const previousLiked = liked;
    const previousCount = count;
    const nextLiked = !previousLiked;
    setLiked(nextLiked);
    setCount(Math.max(0, previousCount + (nextLiked ? 1 : -1)));
    try {
      const response = await fetch(`/api/community/artworks/${encodeURIComponent(artworkId)}/heart`, {
        method: nextLiked ? "PUT" : "DELETE",
        cache: "no-store",
      });
      const result = await response.json() as { liked?: boolean; likesCount?: number };
      if (!response.ok || typeof result.liked !== "boolean" || !Number.isSafeInteger(result.likesCount)) throw new Error("Reaction unavailable");
      setLiked(result.liked);
      setCount(Math.max(0, result.likesCount!));
    } catch {
      setLiked(previousLiked);
      setCount(previousCount);
      setError(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (access === "member") {
    return <div className="inline-flex items-center gap-1.5" data-testid="community-heart-control" data-artwork-id={artworkId}>
      <button
        type="button"
        data-testid="community-heart-toggle"
        aria-label={`${liked ? "Unlike" : "Like"} this artwork, ${count} ${count === 1 ? "heart" : "hearts"}`}
        aria-pressed={liked}
        disabled={pending}
        onClick={toggle}
        className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white/95 px-3 text-sm font-semibold text-[var(--color-ink)] shadow-sm hover:border-[var(--color-terracotta)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] disabled:opacity-60"
      >
        <Heart aria-hidden="true" className={liked ? "size-4 fill-current text-[var(--color-terracotta)]" : "size-4 text-[var(--color-muted)]"} strokeWidth={2} />
        <span data-testid="community-heart-count">{count}</span>
        {pending ? <span className="sr-only">Updating reaction</span> : null}
      </button>
      {error ? <span role="status" className={`inline-flex items-center gap-1 rounded bg-white/95 px-2 py-1 text-xs text-[var(--color-error)] shadow-sm ${compact ? "max-w-32" : ""}`}>
        <span>Your reaction was not saved.</span>
        <button type="button" onClick={toggle} className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2" aria-label="Retry saving your reaction">Retry</button>
      </span> : null}
    </div>;
  }

  const safeReturnTo = returnTo.startsWith("/en/") ? returnTo : "/en/club";
  const href = access === "guest"
    ? `/en/login?returnTo=${encodeURIComponent(safeReturnTo)}`
    : access === "verify"
      ? `/en/login?error=email_unverified&returnTo=${encodeURIComponent(safeReturnTo)}`
      : "/en/account";
  const label = access === "guest" ? "Log in to like" : access === "verify" ? "Verify email to like" : "Join the Coloring Club to like";
  return <div className="inline-flex items-center gap-1.5" data-testid="community-heart-control" data-artwork-id={artworkId}>
    <Link href={href} aria-label={`${label}; ${count} ${count === 1 ? "heart" : "hearts"}`} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white/95 px-3 text-sm font-semibold text-[var(--color-ink)] shadow-sm hover:border-[var(--color-terracotta)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">
      <Heart aria-hidden="true" className="size-4 text-[var(--color-muted)]" strokeWidth={2} /><span data-testid="community-heart-count">{count}</span>
    </Link>
  </div>;
}
