"use client";

import Form from "next/form";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { createContext, useContext, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductCatalogLoading } from "@/components/product-catalog-loading";

type CatalogSubmission = { id: number; href: string };
const CatalogNavigation = createContext<{ pending: boolean; submission: CatalogSubmission | null; navigate: (url: string) => void } | null>(null);

export function CatalogNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submission, setSubmission] = useState<CatalogSubmission | null>(null);
  return <CatalogNavigation.Provider value={{ pending, submission, navigate: (url) => {
    const destination = new URL(url, window.location.href);
    const href = `${destination.pathname}${destination.search}`;
    setSubmission((previous) => ({ id: (previous?.id ?? 0) + 1, href }));
    startTransition(() => router.push(url, { scroll: false }));
  } }}>{children}</CatalogNavigation.Provider>;
}

export function CatalogResults({ children, desktopColumns }: { children: ReactNode; desktopColumns: 3 | 4 | 5 }) {
  const navigation = useContext(CatalogNavigation);
  return navigation?.pending ? <ProductCatalogLoading resultsOnly desktopColumns={desktopColumns} /> : children;
}

/** Keep the same focused DOM input when an enhanced GET commits its new query. */
export function CatalogSearchInput({ value, sourceKey = value, ...props }: Omit<ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange"> & { value: string; sourceKey?: string }) {
  const submission = useContext(CatalogNavigation)?.submission;
  const submissionId = submission?.id ?? 0;
  const [draft, setDraft] = useState({ source: sourceKey, text: value, submissionId, submittedText: value, handledSubmission: 0 });
  let next = draft;
  // Snapshot each input separately: the hidden desktop/mobile sibling may have
  // a different draft from the form which actually submitted this request.
  if (next.submissionId !== submissionId) next = { ...next, submissionId, submittedText: next.text };
  if (next.source !== sourceKey) {
    const newerDraft = submission && next.handledSubmission !== submissionId && sourceKey === submission.href && next.text !== next.submittedText;
    next = { ...next, source: sourceKey, text: newerDraft ? next.text : value, handledSubmission: submissionId };
  }
  if (next !== draft) setDraft(next);
  return <Input {...props} value={next.text} onChange={(event) => {
    const text = event.target.value;
    setDraft((current) => ({ ...current, text }));
  }} />;
}

/** GET remains usable without JS. App navigation preserves scroll and disclosure state. */
export function CatalogForm({ onSubmit, ...props }: ComponentProps<typeof Form>) {
  const navigation = useContext(CatalogNavigation);
  return <Form {...props} scroll={false} onSubmit={(event) => {
    onSubmit?.(event);
    if (event.defaultPrevented || !navigation || typeof props.action !== "string") return;
    const destination = new URL(props.action, window.location.href);
    if (destination.origin !== window.location.origin) return;
    const submitter = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : undefined;
    const fields = new FormData(event.currentTarget, submitter);
    const query = new URLSearchParams();
    for (const [name, value] of fields) query.append(name, typeof value === "string" ? value : value.name);
    destination.search = query.toString();
    event.preventDefault();
    navigation.navigate(`${destination.pathname}${destination.search}${destination.hash}`);
  }} />;
}

export function CatalogSubmitButton({ children, ...props }: ComponentProps<typeof Button> & { children: ReactNode }) {
  const status = useFormStatus();
  const navigation = useContext(CatalogNavigation);
  const pending = navigation?.pending || status.pending;
  return <Button {...props} type="submit" aria-busy={pending || undefined}>
    {children}
    <span aria-hidden data-catalog-form-pending={pending} className={`inline-block size-3 shrink-0 rounded-full border-2 border-current border-r-transparent ${pending ? "opacity-100 motion-safe:animate-spin" : "opacity-0"}`} />
    <span role="status" className="sr-only">{pending ? "Updating catalog" : ""}</span>
  </Button>;
}
