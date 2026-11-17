"use client";

import Form from "next/form";
import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** GET remains usable without JS. App navigation preserves scroll and disclosure state. */
export function CatalogForm(props: ComponentProps<typeof Form>) {
  return <Form {...props} scroll={false} />;
}

export function CatalogSubmitButton({ children, ...props }: ComponentProps<typeof Button> & { children: ReactNode }) {
  const { pending } = useFormStatus();
  return <Button {...props} type="submit" aria-busy={pending || undefined}>
    {children}
    <span aria-hidden data-catalog-form-pending={pending} className={`inline-block size-3 shrink-0 rounded-full border-2 border-current border-r-transparent ${pending ? "opacity-100 motion-safe:animate-spin" : "opacity-0"}`} />
    <span role="status" className="sr-only">{pending ? "Updating catalog" : ""}</span>
  </Button>;
}
