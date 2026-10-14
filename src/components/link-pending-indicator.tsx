"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useState } from "react";

export function LinkPendingIndicator({
  label,
  variant = "card",
}: {
  label: string;
  variant?: "card" | "inline";
}) {
  const { pending } = useLinkStatus();
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
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--color-terracotta)] transition-opacity duration-100 delay-100 motion-reduce:transition-none ${pending ? "opacity-100" : "opacity-0"}`}
          data-pending={pending ? "true" : "false"}
          data-testid="navigation-link-pending"
        />
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
        className={`pointer-events-none absolute bottom-3 left-3 z-10 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/95 px-3 py-2 text-xs font-medium text-[var(--color-ink)] shadow-md transition-[opacity,transform] duration-50 delay-50 motion-reduce:transition-none ${pending ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
        data-pending={pending ? "true" : "false"}
        data-testid="product-card-pending"
      >
        <span
          className={`size-2 shrink-0 rounded-full bg-[var(--color-terracotta)] ${pending ? "motion-safe:animate-pulse" : ""} motion-reduce:animate-none`}
        />
        <span>{label}</span>
      </span>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcePending ? label : ""}
      </span>
    </>
  );
}
