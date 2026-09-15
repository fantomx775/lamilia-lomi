import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-[transform,background-color,border-color,color,box-shadow] duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink-soft)] focus-visible:outline-[var(--color-terracotta)]",
        secondary:
          "bg-[var(--color-sage)] text-[var(--color-ink)] hover:bg-[var(--color-sage-deep)]",
        outline:
          "border border-[var(--color-border)] bg-white/70 text-[var(--color-ink)] hover:bg-[var(--color-blush)]",
        ghost:
          "text-[var(--color-ink)] hover:bg-[var(--color-blush)]",
      },
      size: {
        default: "h-11",
        sm: "h-9 px-3",
        icon: "size-10 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export function buttonClassName(
  variants: (VariantProps<typeof buttonVariants> & { className?: string }) = {},
) {
  const { className, ...rest } = variants;

  return cn(buttonVariants(rest), className);
}
