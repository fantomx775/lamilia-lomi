"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function AdminDrawer({
  open,
  title,
  description,
  onClose,
  children,
  className,
  bodyClassName,
  restoreFocusElement,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  restoreFocusElement?: HTMLElement | null;
}) {
  const [isRendered, setIsRendered] = useState(open);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const openRef = useRef(open);
  const previousOpenRef = useRef(open);
  const closeSequenceRef = useRef(0);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  if (open && !isRendered) {
    setIsRendered(true);
  }

  const finishClose = useCallback((sequence: number) => {
    if (openRef.current || closeSequenceRef.current !== sequence) {
      return;
    }

    setIsRendered(false);
    restoreFocus(previousActiveElementRef.current);
    previousActiveElementRef.current = null;
  }, []);

  useEffect(() => {
    if (open) {
      previousOpenRef.current = true;
      closeSequenceRef.current += 1;
      return;
    }

    if (!previousOpenRef.current || !isRendered) {
      return;
    }

    previousOpenRef.current = false;
    const sequence = closeSequenceRef.current + 1;
    closeSequenceRef.current = sequence;

    if (prefersReducedMotion()) {
      finishClose(sequence);
      return;
    }

    if (dialogRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
  }, [finishClose, isRendered, open]);

  const isMounted = isRendered || open;
  const isExitActive = !open && isMounted;

  useEffect(() => {
    if (!isExitActive || !backdropRef.current) {
      return;
    }

    const backdrop = backdropRef.current;
    const handleAnimationEnd = (event: AnimationEvent) => {
      if (
        event.target === backdrop &&
        (!event.animationName || event.animationName === "admin-drawer-backdrop-exit")
      ) {
        finishClose(closeSequenceRef.current);
      }
    };

    backdrop.addEventListener("animationend", handleAnimationEnd);
    return () => backdrop.removeEventListener("animationend", handleAnimationEnd);
  }, [finishClose, isExitActive]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!previousActiveElementRef.current) {
      previousActiveElementRef.current = restoreFocusElement ?? (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    }
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements(dialogRef.current);

      if (focusable.length === 0) {
        event.preventDefault();
        closeButtonRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (!dialogRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRendered, open, restoreFocusElement]);

  if (!isMounted) {
    return null;
  }

  const drawer = (
    <div
      ref={backdropRef}
      className={cn(
        "admin-drawer-backdrop fixed inset-0 z-50",
        isExitActive && "admin-drawer-exiting",
      )}
      data-slot="admin-drawer"
    >
      <button
        type="button"
        aria-label="Zamknij panel"
        tabIndex={isExitActive ? -1 : undefined}
        className="absolute inset-0 h-full w-full cursor-default bg-[rgb(62_52_47_/_0.28)]"
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={isExitActive ? true : undefined}
        inert={isExitActive || undefined}
        className={cn(
          "admin-drawer-panel absolute inset-y-0 right-0 flex h-dvh w-full max-w-2xl flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl sm:rounded-l-2xl",
          isExitActive && "admin-drawer-exiting",
          className,
        )}
      >
        <div className="sticky top-0 z-20 flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] bg-white/95 px-4 py-3 shadow-[0_4px_16px_rgba(62,52,47,0.05)] backdrop-blur sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-serif text-xl font-semibold sm:text-2xl">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 max-w-xl text-sm leading-5 text-[var(--color-muted)]">{description}</p>
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
        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-8 px-4 py-5 sm:px-6", bodyClassName)}>{children}</div>
      </aside>
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(drawer, document.body);
}

function getFocusableElements(dialog: HTMLElement | null) {
  if (!dialog) {
    return [];
  }

  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && !element.hasAttribute("aria-hidden"),
  );
}

function restoreFocus(element: HTMLElement | null) {
  if (!element || !element.isConnected || element.hasAttribute("disabled") || element.getAttribute("aria-hidden") === "true") {
    return;
  }

  element.focus();
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
