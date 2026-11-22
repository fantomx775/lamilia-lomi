"use client";

import { Check, X } from "lucide-react";
import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type ToastKind = "success" | "error";
type Toast = { id: number; kind: ToastKind; message: string; scope?: string };
type ToastOptions = { scope?: string };
type ToastContextValue = {
  showToast: (kind: ToastKind, message: string, options?: ToastOptions) => void;
  resolveToast: (scope: string) => void;
};
const ToastContext = createContext<ToastContextValue | null>(null);
const noToast: ToastContextValue = { showToast: () => undefined, resolveToast: () => undefined };

/** Errors remain until dismissed. Errors take priority over transient successes;
 * later successes wait behind errors. Repeating the visible event restarts it.
 * Operation results/errors must also remain at the originating control/form. */
export function ToastProvider({ children, dismissLabel = "Dismiss notification" }: { children: ReactNode; dismissLabel?: string }) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const sequence = useRef(0);
  const publish = useCallback((kind: ToastKind, message: string, options?: ToastOptions) => {
    const next = { id: ++sequence.current, kind, message, scope: options?.scope };
    setQueue((previous) => {
      // A successful explicit retry resolves only its own operation's error.
      const current = kind === "success" && options?.scope
        ? previous.filter((item) => !(item.kind === "error" && item.scope === options.scope))
        : previous;
      if (current[0]?.kind === kind && current[0].message === message && current[0].scope === next.scope) return [next, ...current.slice(1)];
      if (kind === "error") return [...current.filter((item) => item.kind === "error"), next];
      // A burst of successes needs only its latest result; never discard an error.
      return [...current.filter((item) => item.kind === "error"), next];
    });
  }, []);
  const resolve = useCallback((scope: string) => {
    if (scope) setQueue((current) => current.filter((item) => !(item.kind === "error" && item.scope === scope)));
  }, []);
  const remove = useCallback((id: number) => setQueue((current) => current.filter((item) => item.id !== id)), []);
  const toast = queue[0];

  return (
    <ToastContext.Provider value={{ showToast: publish, resolveToast: resolve }}>
      {children}
      {toast ? <ToastNotice key={toast.id} toast={toast} dismissLabel={dismissLabel} onComplete={remove} /> : null}
    </ToastContext.Provider>
  );
}

function ToastNotice({ toast, dismissLabel, onComplete }: { toast: Toast; dismissLabel: string; onComplete: (id: number) => void }) {
  const region = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<Element | null>(() => {
    if (typeof document === "undefined") return null;
    const dialogs = document.querySelectorAll("dialog[open]");
    return dialogs.item(dialogs.length - 1) ?? document.body;
  });
  const remaining = useRef(6000);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    // Modal dialogs make the rest of the document inert. Keep the notification
    // inside the active modal, then move it back out when the drawer closes.
    const syncHost = () => {
      const dialogs = document.querySelectorAll("dialog[open]");
      setHost(dialogs.item(dialogs.length - 1) ?? document.body);
    };
    const observer = new MutationObserver(syncHost);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    syncHost();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // A manual popover participates in the top layer, including above native
    // modal drawers, without taking focus or closing on an unrelated click.
    const element = region.current;
    if (element?.showPopover) element.showPopover();
    else element?.removeAttribute("popover");
    const visibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      element?.hidePopover?.();
    };
  }, [host]);

  useEffect(() => {
    if (toast.kind === "error" || closing || hovered || focused || hidden || document.visibilityState === "hidden") return;
    const started = Date.now();
    const timer = window.setTimeout(() => setClosing(true), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [toast.kind, closing, hovered, focused, hidden]);

  useEffect(() => {
    if (!closing) return;
    // The fallback also works when animationend is absent or motion is reduced.
    const timer = window.setTimeout(() => onComplete(toast.id), 160);
    return () => window.clearTimeout(timer);
  }, [closing, onComplete, toast.id]);

  if (!host) return null;
  return createPortal(
    <div ref={region} popover={typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype ? "manual" : undefined} data-toast-region data-closing={closing || undefined}
      className="pointer-events-none fixed inset-x-0 top-[calc(5rem+env(safe-area-inset-top))] bottom-auto z-[110] m-0 w-auto max-w-none overflow-visible border-0 bg-transparent px-4 py-0 text-inherit">
      <div className={`toast-notice pointer-events-auto mx-auto flex max-h-[calc(100dvh-6rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-xl items-start gap-3 overflow-y-auto rounded-xl border px-4 py-3 shadow-xl ${toast.kind === "success" ? "border-[var(--color-sage-deep)] bg-[var(--color-sage)] text-[var(--color-ink)]" : "border-red-200 bg-red-50 text-red-950"}`}
        data-closing={closing || undefined} data-toast-id={toast.id}
        role={toast.kind === "error" ? "alert" : "status"} aria-live={toast.kind === "error" ? "assertive" : "polite"} aria-atomic="true"
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        {toast.kind === "success" ? <Check className="mt-0.5 size-5 shrink-0 text-[var(--color-ink)]" aria-hidden="true" /> : <span className="mt-0.5 size-5 shrink-0 text-center font-bold text-red-700" aria-hidden="true">!</span>}
        <p className="min-w-0 flex-1 break-words text-sm font-medium leading-6 [overflow-wrap:anywhere]">{toast.message}</p>
        <button type="button" onClick={() => setClosing(true)} className="inline-flex size-11 shrink-0 items-center justify-center rounded text-current opacity-70 hover:opacity-100 active:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={dismissLabel}><X className="size-4" aria-hidden="true" /></button>
      </div>
    </div>,
    host,
  );
}

export function useToast() {
  return useContext(ToastContext) ?? noToast;
}
