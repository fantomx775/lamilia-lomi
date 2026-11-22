"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Locale } from "@/i18n/routing";
import { validateContactInput } from "@/lib/contact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

type Fields = Partial<Record<"name" | "email" | "message", string>>;
export function ContactForm({ locale, requestId }: { locale: Locale; requestId: string }) {
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Fields>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useToast();
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); if (timeout.current) clearTimeout(timeout.current); }; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = { name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), message: String(data.get("message") ?? ""), locale };
    const parsed = validateContactInput(input);
    if (!parsed.success) {
      const nextFields = Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message])) as Fields;
      setFields(nextFields);
      form.querySelector<HTMLElement>(`[name="${Object.keys(nextFields)[0]}"]`)?.focus();
      return;
    }
    busy.current = true;
    setPending(true); setFields({}); setResult(null);
    const abort = new AbortController(); controller.current = abort;
    timeout.current = setTimeout(() => abort.abort(), 15_000);
    try {
      const body = new URLSearchParams({ ...parsed.data, requestId });
      const response = await fetch("/api/contact", { method: "POST", body, signal: abort.signal, headers: { accept: "application/json" } });
      const payload = await response.json() as { ok?: boolean; error?: string; fields?: Fields };
      if (!alive.current) return;
      const ok = response.ok && payload.ok === true;
      const message = ok ? "Your message has been accepted. Thank you for getting in touch." : payload.error ?? "Your message was not accepted. Please try again.";
      setFields(payload.fields ?? {}); setResult({ ok, message });
      showToast(ok ? "success" : "error", message, { scope: "contact" });
    } catch {
      if (!alive.current) return;
      const message = "We could not confirm delivery. Your draft is still here. Retry the same message safely.";
      setResult({ ok: false, message }); showToast("error", message, { scope: "contact" });
    } finally {
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = null; controller.current = null;
      busy.current = false; if (alive.current) setPending(false);
    }
  }

  return <form data-analytics-form="contact" action="/api/contact" method="post" className="grid gap-4" aria-busy={pending || undefined} onSubmit={submit} onInvalidCapture={(event) => {
    const field = event.target;
    if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && ["name", "email", "message"].includes(field.name)) setFields((current) => ({ ...current, [field.name]: field.validationMessage }));
  }}>
    <input type="hidden" name="locale" value={locale} /><input type="hidden" name="requestId" value={requestId} />
    <div className="grid gap-2"><Label htmlFor="contact-name">Name</Label><Input id="contact-name" name="name" autoComplete="name" readOnly={pending} required minLength={2} maxLength={80} aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? "contact-name-error" : undefined} />{fields.name ? <p id="contact-name-error" className="text-sm text-[var(--color-error)]">{fields.name}</p> : null}</div>
    <div className="grid gap-2"><Label htmlFor="contact-email">Email</Label><Input id="contact-email" name="email" type="email" autoComplete="email" readOnly={pending} required maxLength={254} aria-invalid={Boolean(fields.email)} aria-describedby={fields.email ? "contact-email-error" : undefined} />{fields.email ? <p id="contact-email-error" className="text-sm text-[var(--color-error)]">{fields.email}</p> : null}</div>
    <div className="grid gap-2"><Label htmlFor="contact-message">Message</Label><Textarea id="contact-message" name="message" readOnly={pending} required minLength={10} maxLength={3000} aria-invalid={Boolean(fields.message)} aria-describedby={fields.message ? "contact-message-error" : undefined} />{fields.message ? <p id="contact-message-error" className="text-sm text-[var(--color-error)]">{fields.message}</p> : null}</div>
    {result ? <p role={result.ok ? "status" : "alert"} className={`rounded-md p-3 text-sm ${result.ok ? "bg-[var(--color-sage)] text-[var(--color-ink)]" : "bg-[var(--color-error-bg)] text-[var(--color-error)]"}`}>{result.message}</p> : null}
    <Button type="submit" disabled={pending} className="min-w-32 justify-self-start"><span aria-hidden className={`size-3 rounded-full border-2 border-current border-r-transparent ${pending ? "motion-safe:animate-spin" : "opacity-0"}`} />{pending ? "Sending…" : "Send"}</Button>
  </form>;
}
