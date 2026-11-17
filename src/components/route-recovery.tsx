"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { NavigationLink } from "@/components/navigation-link";

export function SectionRecovery({ title = "This section could not be loaded" }: { title?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div role="alert" className="rounded-xl border border-[var(--color-border)] bg-white/80 p-6">
    <h2 className="font-serif text-xl font-semibold">{title}</h2>
    <p className="mt-2 text-sm text-[var(--color-muted)]">Your place is saved. Please try again.</p>
    <Button className="mt-4" variant="outline" aria-busy={pending || undefined} disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Trying again…" : "Try again"}</Button>
  </div>;
}

export function RouteRecovery({ retry, title, backHref, backLabel }: { retry: () => void; title: string; backHref: string; backLabel: string }) {
  const [pending, startTransition] = useTransition();
  return <section role="alert" className="mx-auto min-h-[50vh] max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
    <h1 className="font-serif text-3xl font-semibold">{title}</h1>
    <p className="mt-3 max-w-xl text-[var(--color-muted)]">We could not load this page. This is a loading error, rather than an empty result.</p>
    <div className="mt-6 flex flex-wrap gap-3">
      <Button disabled={pending} aria-busy={pending || undefined} onClick={() => startTransition(() => retry())}>{pending ? "Trying again…" : "Try again"}</Button>
      <NavigationLink href={backHref} pendingLabel={`Opening ${backLabel}`} className="inline-flex min-h-11 items-center rounded-md border border-[var(--color-border)] px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2">{backLabel}</NavigationLink>
    </div>
  </section>;
}
