"use client";

import { useCommunityLinkPending } from "@/components/community/community-route-transition";
import { useLinkStatus } from "next/link";
import { useEffect, useState } from "react";

export function LinkPendingIndicator({
  label,
  variant = "card",
  showInlineBar = true,
  pendingOverride,
}: {
  label: string;
  variant?: "card" | "inline";
  showInlineBar?: boolean;
  pendingOverride?: boolean;
}) {
  const { pending: linkPending } = useLinkStatus();
  const managedPending = useCommunityLinkPending();
  const pending = pendingOverride ?? managedPending ?? linkPending;
  const [announcePending, setAnnouncePending] = useState(false);

  useEffect(() => {
    if (pending && !announcePending) {
      const timeout = window.setTimeout(() => setAnnouncePending(true), 150);
      return () => window.clearTimeout(timeout);
    }

    if (!pending && announcePending) {
      const timeout = window.setTimeout(() => setAnnouncePending(false), 0);
      return () => window.clearTimeout(timeout);
    }
  }, [pending, announcePending]);

  if (variant === "inline") {
    return (
      <>
        {showInlineBar ? (
          <span
            aria-hidden="true"
            className={`pointer-events-none ml-1 inline-block size-3 shrink-0 self-center rounded-full border-2 border-current border-r-transparent transition-opacity duration-100 motion-reduce:transition-none ${pendingOverride ? "delay-0" : "delay-100"} ${pending ? "opacity-100 motion-safe:animate-spin" : "opacity-0"}`}
            data-pending={pending ? "true" : "false"}
            data-testid="navigation-link-pending"
          />
        ) : null}
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcePending ? label : ""}
        </span>
      </>
    );
  }

  return (
    <>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-3 left-3 z-10 inline-flex max-w-[calc(100%_-_1.5rem)] items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/95 px-3 py-2 text-xs font-medium text-[var(--color-ink)] shadow-md transition-[opacity,transform] duration-50 delay-50 motion-reduce:transition-none ${pending ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
        data-pending={pending ? "true" : "false"}
        data-testid="product-card-pending"
      >
        <span
          className={`size-2 shrink-0 rounded-full bg-[var(--color-terracotta)] ${pending ? "motion-safe:animate-pulse" : ""} motion-reduce:animate-none`}
        />
        <span className="min-w-0">{label}</span>
      </span>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcePending ? label : ""}
      </span>
    </>
  );
}
