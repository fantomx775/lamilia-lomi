import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-32 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-3 text-sm text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-muted)] focus:border-[var(--color-terracotta)] focus:ring-4 focus:ring-[var(--color-terracotta-ring)]",
        className,
      )}
      {...props}
    />
  );
}
