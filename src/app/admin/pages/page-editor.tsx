"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { AdminEditorHeader, AdminEditorSection } from "@/components/admin/admin-editor-foundation";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { AdminSaveBar } from "@/components/admin/admin-save-bar";
import { useAdminToast } from "@/components/admin/admin-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StaticPageRecord } from "@/lib/types";

type PageValue = { title: string; body: string };
type PageNavigateEvent = Event & { navigationType?: string; destination?: { url?: string } };
type PageNavigation = {
  addEventListener(type: "navigate", listener: (event: PageNavigateEvent) => void): void;
  removeEventListener(type: "navigate", listener: (event: PageNavigateEvent) => void): void;
};
type PageEditorWindow = Window & { navigation?: PageNavigation };

export function PageEditor({
  slug,
  title,
  records,
  feedback,
  feedbackEventId,
  saved = false,
  savedEventId,
  saveAction,
}: {
  slug: StaticPageRecord["slug"];
  title: string;
  records: StaticPageRecord[];
  feedback?: string;
  feedbackEventId?: string;
  saved?: boolean;
  savedEventId?: string;
  saveAction?: (formData: FormData) => void | Promise<void>;
}) {
  const savedValue = useMemo(() => buildValue(records), [records]);
  const savedValueSignature = JSON.stringify(savedValue);
  const [baselineValue, setBaselineValue] = useState<PageValue>(() => savedValue);
  const baselineSignatureRef = useRef(savedValueSignature);
  const lastSuccessEventRef = useRef(savedEventId);
  const submittedValueRef = useRef<PageValue | null>(null);
  const submittedDraftGenerationRef = useRef(0);
  const draftGenerationRef = useRef(0);
  const isDirtyRef = useRef(false);
  const [value, setValue] = useState<PageValue>(() => savedValue);
  const [hasUnappliedHtmlDraft, setHasUnappliedHtmlDraft] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [transportFailed, setTransportFailed] = useState(false);
  const [feedbackDismissed, setFeedbackDismissed] = useState(false);
  const saveInProgressRef = useRef(false);
  const lastFeedbackEventRef = useRef(feedbackEventId ?? feedback);
  const publishToast = useAdminToast();
  const isDirty = hasUnappliedHtmlDraft || value.title !== baselineValue.title || value.body !== baselineValue.body;

  useEffect(() => {
    const newSuccessEvent = Boolean(savedEventId && savedEventId !== lastSuccessEventRef.current);
    if (!saved || (!newSuccessEvent && savedValueSignature === baselineSignatureRef.current)) return;
    lastSuccessEventRef.current = savedEventId;
    baselineSignatureRef.current = savedValueSignature;
    setBaselineValue(savedValue);
    const submitted = submittedValueRef.current;
    if (submitted && JSON.stringify(value) === JSON.stringify(submitted) && draftGenerationRef.current === submittedDraftGenerationRef.current) {
      setValue(savedValue);
      setHasUnappliedHtmlDraft(false);
    }
    submittedValueRef.current = null;
    saveInProgressRef.current = false;
    setIsSaving(false);
    setTransportFailed(false);
  }, [saved, savedEventId, savedValue, savedValueSignature, value]);

  useEffect(() => {
    const currentFeedbackEvent = feedbackEventId ?? feedback;
    if (!currentFeedbackEvent || currentFeedbackEvent === lastFeedbackEventRef.current) return;
    lastFeedbackEventRef.current = currentFeedbackEvent;
    setFeedbackDismissed(false);
    saveInProgressRef.current = false;
    setIsSaving(false);
    setTransportFailed(false);
    submittedValueRef.current = null;
  }, [feedback, feedbackEventId]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    const owner = window.location.href;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const confirmNavigation = () => {
      if (!isDirtyRef.current) return true;
      const confirmed = window.confirm("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?");
      if (confirmed) isDirtyRef.current = false;
      return confirmed;
    };

    const handleInternalClick = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === owner) return;
      if (confirmNavigation()) return;
      event.preventDefault();
      event.stopPropagation();
      if ("stopImmediatePropagation" in event) event.stopImmediatePropagation();
    };

    const navigation = (window as PageEditorWindow).navigation;
    const handleNavigate = (event: PageNavigateEvent) => {
      const destination = event.destination?.url;
      if (!destination) return;
      const nextUrl = new URL(destination, window.location.href);
      const currentUrl = new URL(owner);
      if (nextUrl.origin === currentUrl.origin && nextUrl.pathname === currentUrl.pathname) return;
      if (!confirmNavigation()) event.preventDefault();
    };
    const handlePopState = () => {
      if (!confirmNavigation()) window.history.forward();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleInternalClick, true);
    if (navigation) navigation.addEventListener("navigate", handleNavigate);
    else window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleInternalClick, true);
      if (navigation) navigation.removeEventListener("navigate", handleNavigate);
      else window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const updateValue = (field: keyof PageValue, value: string) => {
    setFeedbackDismissed(true);
    setTransportFailed(false);
    setValue((current) => {
      const next = { ...current, [field]: value };
      isDirtyRef.current = hasUnappliedHtmlDraft || next.title !== baselineValue.title || next.body !== baselineValue.body;
      return next;
    });
  };

  const updateHtmlDraftState = (hasDraft: boolean) => {
    setFeedbackDismissed(true);
    setTransportFailed(false);
    draftGenerationRef.current += 1;
    setHasUnappliedHtmlDraft(hasDraft);
    isDirtyRef.current = hasDraft || value.title !== baselineValue.title || value.body !== baselineValue.body;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasUnappliedHtmlDraft) {
      return;
    }
    if (!saveAction || saveInProgressRef.current) return;
    saveInProgressRef.current = true;
    setIsSaving(true);
    setFeedbackDismissed(false);
    setTransportFailed(false);
    submittedValueRef.current = value;
    submittedDraftGenerationRef.current = draftGenerationRef.current;
    const formData = new FormData(event.currentTarget);
    void Promise.resolve(saveAction(formData)).catch(() => {
      saveInProgressRef.current = false;
      setIsSaving(false);
      setTransportFailed(true);
      publishToast("error", "Nie udało się wysłać zapisu. Twoje zmiany pozostały w edytorze.");
    });
  };

  return (
    <form id="page-editor-form" action={saveAction} onSubmit={handleSubmit} className="grid gap-6 pb-28">
      <input type="hidden" name="slug" value={slug} />
      <AdminEditorHeader
        backHref="/admin/pages"
        backLabel="Strony"
        title={title}
        subtitle={`Klucz strony: ${slug}`}
      />

      {feedback && !feedbackDismissed ? <div role="alert" className="rounded-md border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-error)]">{feedback}</div> : null}
      {hasUnappliedHtmlDraft ? <p role="alert" className="text-sm text-[var(--color-error)]">Najpierw zastosuj lub odrzuć roboczy kod HTML przed zapisaniem.</p> : null}

      <AdminEditorSection title="Ustawienia strony" description="Klucz strony jest stały i wspólny dla wszystkich adresów.">
        <div className="grid gap-2">
          <span className="text-sm font-medium">Klucz strony</span>
          <code className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm">{slug}</code>
        </div>
      </AdminEditorSection>

      <AdminEditorSection title="Treść strony" description="Edytujesz wersję angielską; pozostałe istniejące treści i publiczne adresy pozostają bez zmian.">
        <div className="grid gap-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="page-title">Tytuł</Label>
              <Input id="page-title" name="title" value={value.title} onChange={(event) => updateValue("title", event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="page-body">Treść</Label>
              <RichTextEditor id="page-body" name="body" label="Treść" value={value.body} onChange={(body) => updateValue("body", body)} onSourceDraftChange={updateHtmlDraftState} />
            </div>
          </div>
        </div>
      </AdminEditorSection>

      {isDirty ? <p className="text-sm text-[var(--color-terracotta)]" role="status" aria-live="polite">Masz niezapisane zmiany.</p> : null}

      <PageSaveBar dirty={isDirty} pending={isSaving} status={transportFailed || (feedback && !feedbackDismissed) ? "error" : saved ? "saved" : "idle"} disabled={!saveAction || hasUnappliedHtmlDraft} errorMessage={transportFailed ? "Nie udało się połączyć z serwerem. Twoje zmiany pozostały w edytorze." : undefined} />
    </form>
  );
}

function PageSaveBar({ dirty, pending, status, disabled, errorMessage }: { dirty: boolean; pending: boolean; status: "idle" | "saved" | "error"; disabled: boolean; errorMessage?: string }) {
  return <AdminSaveBar formId="page-editor-form" dirty={dirty} pending={pending} status={status} disabled={disabled} errorMessage={errorMessage} />;
}

function buildValue(records: StaticPageRecord[]): PageValue {
  const english = records.find((record) => record.locale === "en");
  return { title: english?.title ?? "", body: english?.body ?? "" };
}
