"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export function AdminDrawer({
  open,
  title,
  description,
  onClose,
  children,
  className,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50" data-slot="admin-drawer">
      <button
        type="button"
        aria-label="Zamknij panel"
        className="absolute inset-0 h-full w-full cursor-default bg-[rgb(62_52_47_/_0.28)]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-drawer-title"
        className={cn(
          "absolute inset-y-0 right-0 flex h-dvh w-full max-w-xl flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl",
          className,
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] bg-white/80 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="admin-drawer-title" className="font-serif text-2xl font-semibold">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{description}</p>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-white text-[var(--color-ink)] transition hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Zamknij panel</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      </aside>
    </div>
  );
}
