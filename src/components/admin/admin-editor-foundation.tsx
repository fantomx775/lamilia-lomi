import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function AdminEditorHeader({
  backHref,
  backLabel,
  title,
  subtitle,
  status,
  actions,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  subtitle?: string;
  status?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-[var(--color-border)] pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-terracotta)] transition hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {backLabel}
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl font-semibold sm:text-4xl">{title}</h1>
          {status}
        </div>
        {subtitle ? (
          <p className="mt-2 max-w-2xl break-words text-sm text-[var(--color-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function AdminEditorSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <h2 className="font-serif text-2xl font-semibold">{title}</h2>
        {description ? (
          <p className="max-w-2xl text-sm leading-6 text-[var(--color-muted)]">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
