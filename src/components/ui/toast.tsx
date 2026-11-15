"use client";

import { Check, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type ToastKind = "success" | "error";
type Toast = { id: number; kind: ToastKind; message: string };
type ToastContextValue = { showToast: (kind: ToastKind, message: string) => void };
const ToastContext = createContext<ToastContextValue | null>(null);
const noToast: ToastContextValue = { showToast: () => undefined };

export function ToastProvider({ children, dismissLabel = "Dismiss notification" }: { children: ReactNode; dismissLabel?: string }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const sequence = useRef(0);
  const publish = useCallback((kind: ToastKind, message: string) => {
    sequence.current += 1;
    const id = sequence.current;
    setToast((current) => current?.kind === kind && current.message === message ? current : { id, kind, message });
  }, []);

  useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ showToast: publish }}>
      {children}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(4.5rem+env(safe-area-inset-top))] z-[110] flex justify-center px-4 sm:top-6">
          <div className={`pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-xl border px-4 py-3 shadow-xl ${toast.kind === "success" ? "border-[var(--color-sage-deep)] bg-[var(--color-sage)] text-[var(--color-ink)]" : "border-red-200 bg-red-50 text-red-950"}`} role={toast.kind === "error" ? "alert" : "status"} aria-live={toast.kind === "error" ? "assertive" : "polite"}>
            {toast.kind === "success" ? <Check className="mt-0.5 size-5 shrink-0 text-[var(--color-ink)]" aria-hidden="true" /> : <span className="mt-0.5 size-5 shrink-0 text-center font-bold text-red-700" aria-hidden="true">!</span>}
            <p className="min-w-0 flex-1 text-sm font-medium leading-6">{toast.message}</p>
            <button type="button" onClick={() => setToast(null)} className="inline-flex size-11 shrink-0 items-center justify-center rounded text-current opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={dismissLabel}><X className="size-4" aria-hidden="true" /></button>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  return value ?? noToast;
}
