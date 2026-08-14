"use client";

import { Search } from "lucide-react";
import { useId } from "react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AdminResourceTableShellProps = {
  title: string;
  description?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchAriaLabel: string;
  resultsLabel: string;
  toolbarActions?: React.ReactNode;
  filters?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function AdminResourceTableShell({
  title,
  description,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  resultsLabel,
  toolbarActions,
  filters,
  children,
  className,
}: AdminResourceTableShellProps) {
  const searchId = useId();

  return (
    <div className={cn("min-w-0 space-y-8", className)}>
      <header>
        <p className="text-sm font-medium text-[var(--color-terracotta)]">Panel administracyjny</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">{description}</p>
        ) : null}
      </header>

      <Card className="min-w-0 overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <label className="sr-only" htmlFor={searchId}>
              {searchAriaLabel}
            </label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]"
              />
              <Input
                id={searchId}
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchAriaLabel}
                className="pl-9"
              />
            </div>
            <p aria-live="polite" className="text-sm text-[var(--color-muted)]">
              {resultsLabel}
            </p>
          </div>

          {toolbarActions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{toolbarActions}</div>
          ) : null}
        </div>

        {filters ? (
          <div className="border-t border-[var(--color-border)] px-4 py-4 sm:px-5">{filters}</div>
        ) : null}

        <div className="border-t border-[var(--color-border)] p-4 sm:p-5">{children}</div>
      </Card>
    </div>
  );
}
