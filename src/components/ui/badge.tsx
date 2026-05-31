import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-blush)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink)]",
        className,
      )}
      {...props}
    />
  );
}
