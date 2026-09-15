"use client";

import { useLinkStatus } from "next/link";

export function LinkPendingIndicator({ label }: { label: string }) {
  const { pending } = useLinkStatus();

  return (
    <>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-lg transition-opacity duration-150 motion-reduce:transition-none ${pending ? "delay-100 opacity-100" : "opacity-0"}`}
        data-pending={pending ? "true" : "false"}
        data-testid="product-card-pending"
      >
        <span
          className={`block h-full w-1/3 rounded-full bg-[var(--color-terracotta)] ${pending ? "motion-safe:animate-pulse" : ""} motion-reduce:animate-none`}
        />
      </span>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {pending ? label : ""}
      </span>
    </>
  );
}
