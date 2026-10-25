"use client";

import { Check, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type AdminToastKind = "success" | "error";
type Toast = { id: number; kind: AdminToastKind; message: string };
type ToastContextValue = { publish: (kind: AdminToastKind, message: string) => void };
const ToastContext = createContext<ToastContextValue | null>(null);
const noopPublish = () => undefined;

export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const sequence = useRef(0);
  const publish = useCallback((kind: AdminToastKind, message: string) => {
    sequence.current += 1;
    setToast({ id: sequence.current, kind, message });
  }, []);

  useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ publish }}>
      {children}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4 sm:top-6">
          <div className={`pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-xl border px-4 py-3 shadow-xl ${toast.kind === "success" ? "border-[var(--color-sage-deep)] bg-[var(--color-sage)] text-[var(--color-ink)]" : "border-red-200 bg-red-50 text-red-950"}`} role={toast.kind === "error" ? "alert" : "status"} aria-live={toast.kind === "error" ? "assertive" : "polite"}>
            {toast.kind === "success" ? <Check className="mt-0.5 size-5 shrink-0 text-[var(--color-ink)]" aria-hidden="true" /> : <span className="mt-0.5 size-5 shrink-0 text-center font-bold text-red-700" aria-hidden="true">!</span>}
            <p className="min-w-0 flex-1 text-sm font-medium leading-6">{toast.message}</p>
            <button type="button" onClick={() => setToast(null)} className="rounded p-1 text-current opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label="Zamknij powiadomienie"><X className="size-4" aria-hidden="true" /></button>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useAdminToast() {
  const value = useContext(ToastContext);
  return value?.publish ?? noopPublish;
}

/** Consumes one server-confirmed redirect flash and removes it from browser history. */
export function AdminRouteToast({ eventId, kind, message, cleanPath }: {
  eventId?: string;
  kind?: AdminToastKind;
  message?: string;
  cleanPath: string;
}) {
  const publish = useAdminToast();
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!eventId || !kind || !message || seen.current === eventId) return;
    seen.current = eventId;
    const key = `admin-toast:${eventId}`;
    let alreadySeen = false;
    try {
      alreadySeen = window.sessionStorage.getItem(key) === "1";
      if (!alreadySeen) window.sessionStorage.setItem(key, "1");
    } catch {
      // The URL is still cleaned below when storage is unavailable.
    }
    if (!alreadySeen) publish(kind, message);
    const url = new URL(window.location.href);
    url.pathname = cleanPath;
    url.searchParams.delete("toast");
    url.searchParams.delete("error");
    url.searchParams.delete("saved");
    url.searchParams.delete("deleted");
    url.searchParams.delete("archived");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [cleanPath, eventId, kind, message, publish]);
  return null;
}
