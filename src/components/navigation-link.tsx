"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { LinkPendingIndicator } from "@/components/link-pending-indicator";

type NavigationLinkProps = ComponentProps<typeof Link> & {
  pendingLabel: string;
};

/** A semantic Next.js link with a small, delayed hint while navigation is pending. */
export function NavigationLink({
  children,
  className,
  pendingLabel,
  ...props
}: NavigationLinkProps) {
  return (
    <Link {...props} className={[className, "relative"].filter(Boolean).join(" ")}>
      {children}
      <LinkPendingIndicator label={pendingLabel} variant="inline" />
    </Link>
  );
}
