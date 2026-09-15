"use client";

import { useLinkStatus } from "next/link";

export function LinkPendingIndicator({ label }: { label: string }) {
  const { pending } = useLinkStatus();

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
        {pending ? label : ""}
      </span>
    </>
  );
}
