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

/** Shared by client submit failures and their server-confirmed redirect result. */
export function adminRouteToastScope(cleanPath: string, operation: "save" | "delete" | "archive" = "save") {
  if (/^\/admin\/products(?:\/|$)/.test(cleanPath)) return `product-${operation}`;
  return `admin-${operation}:${cleanPath}`;
}

/** Consumes one server-confirmed redirect flash and removes it from browser history. */
export function AdminRouteToast({ eventId, kind, message, cleanPath, operation }: {
  eventId?: string;
  kind?: AdminToastKind;
  message?: string;
  cleanPath: string;
  operation?: "save" | "delete" | "archive";
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
    const url = new URL(window.location.href);
    const originatingOperation = operation ?? (url.searchParams.has("deleted") ? "delete" : url.searchParams.has("archived") ? "archive" : "save");
    if (!alreadySeen) publish(kind, message, { scope: adminRouteToastScope(cleanPath, originatingOperation) });
    url.pathname = cleanPath;
    url.searchParams.delete("toast");
    url.searchParams.delete("error");
    url.searchParams.delete("saved");
    url.searchParams.delete("deleted");
    url.searchParams.delete("archived");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [cleanPath, eventId, kind, message, operation, publish]);
  return null;
}
