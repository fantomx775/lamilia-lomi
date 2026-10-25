"use client";

import { Save } from "lucide-react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { Button, buttonClassName } from "@/components/ui/button";

export type AdminSaveStatus = "idle" | "saved" | "error";

/** Shared fixed save bar for admin editors. The submit button targets the editor form by ID. */
export function AdminSaveBar({
  formId,
  dirty,
  pending,
  status = "idle",
  disabled = false,
  testId = "admin-save-bar",
  idleMessage,
  savedMessage,
  errorMessage,
  allowCleanSubmit = false,
  nativeSubmitLabel = "Zapisz",
}: {
  formId: string;
  dirty: boolean;
  pending: boolean;
  status?: AdminSaveStatus;
  disabled?: boolean;
  testId?: string;
  idleMessage?: string;
  savedMessage?: string;
  errorMessage?: string;
  allowCleanSubmit?: boolean;
  nativeSubmitLabel?: string;
}) {
  const portalRoot = useSyncExternalStore<HTMLElement | null>(subscribeToDocument, getDocumentBody, getServerDocument);

  const bar = (
    <div data-testid={testId} className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-white/95 px-4 pt-3 shadow-[0_-8px_30px_rgba(47,35,29,0.08)] backdrop-blur sm:px-6 lg:left-64 lg:px-8" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <p role={status === "error" ? "alert" : "status"} aria-live={status === "error" ? "assertive" : "polite"} className={`min-w-0 text-sm ${status === "error" ? "text-red-800" : "text-[var(--color-muted)]"}`}>
          {pending ? "Zapisywanie…" : status === "error" ? (errorMessage ?? `Błąd zapisu.${dirty ? " Niezapisane zmiany pozostają w edytorze." : " Popraw wskazane pola i spróbuj ponownie."}`) : dirty ? "Niezapisane zmiany" : status === "saved" ? (savedMessage ?? "Zapisano") : (idleMessage ?? "Wszystkie zmiany są zapisane")}
        </p>
        <Button type="submit" form={formId} disabled={pending || disabled || (!dirty && !allowCleanSubmit)} className="shrink-0">
          <Save className="size-4" aria-hidden />{pending ? "Zapisywanie…" : dirty ? "Zapisz zmiany" : "Zapisz"}
        </Button>
      </div>
    </div>
  );
  if (portalRoot) return createPortal(bar, portalRoot);
  return <noscript><div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-white px-4 py-3 shadow-[0_-8px_30px_rgba(47,35,29,0.08)] lg:left-64 sm:px-6 lg:px-8"><div className="mx-auto flex max-w-6xl justify-end"><button type="submit" form={formId} disabled={disabled} className={buttonClassName({ className: "shrink-0" })}>{nativeSubmitLabel}</button></div></div></noscript>;
}

function subscribeToDocument() {
  return () => undefined;
}

function getDocumentBody() {
  return document.body;
}

function getServerDocument() {
  return null;
}
