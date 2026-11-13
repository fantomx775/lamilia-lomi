"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ToastProvider, useToast, type ToastKind } from "@/components/ui/toast";

export type AdminToastKind = ToastKind;

export function AdminToastProvider({ children }: { children: ReactNode }) {
  return <ToastProvider dismissLabel="Zamknij powiadomienie">{children}</ToastProvider>;
}

export function useAdminToast() {
  return useToast().showToast;
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
