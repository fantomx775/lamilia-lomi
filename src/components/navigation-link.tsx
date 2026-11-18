"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { CommunityLinkPendingScope, communityRouteTarget, useCommunityRouteNavigation } from "@/components/community/community-route-transition";
import { LinkPendingIndicator } from "@/components/link-pending-indicator";

type NavigationLinkProps = ComponentProps<typeof Link> & {
  pendingLabel: string;
  showPendingBar?: boolean;
  pending?: boolean;
};

/** A semantic Next.js link with a fixed-size, delayed hint while navigation is pending. */
export function NavigationLink({
  children,
  className,
  pendingLabel,
  showPendingBar = true,
  pending,
  href,
  onNavigate,
  replace,
  scroll,
  ...props
}: NavigationLinkProps) {
  const community = useCommunityRouteNavigation();
  const target = community && typeof href === "string" ? communityRouteTarget(href, typeof window === "undefined" ? undefined : window.location.origin) : null;
  const managedPending = target ? community?.active?.href === target.href : undefined;
  const effectivePending = pending ?? managedPending;
  return (
    <CommunityLinkPendingScope pending={effectivePending}><Link {...props} href={href} replace={replace} scroll={scroll}
      onNavigate={(event) => {
        let prevented = false;
        onNavigate?.({ preventDefault() { prevented = true; event.preventDefault(); } });
        if (!prevented && community) {
          if (typeof href === "string" && community.navigate(href, { replace, scroll })) event.preventDefault();
          else community.cancel();
        }
      }} className={[className, "relative"].filter(Boolean).join(" ")}>
      {children}
      <LinkPendingIndicator label={pendingLabel} variant="inline" showInlineBar={showPendingBar} pendingOverride={effectivePending} />
    </Link></CommunityLinkPendingScope>
  );
}
