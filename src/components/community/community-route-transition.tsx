"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CommunityLoading } from "@/components/community/community-loading";

export const mobileNavigationHistoryKey = "lamiliaMobileNavigation";
type Target = { href: string; variant: "gallery" | "artwork" | "creator" };
type Options = { replace?: boolean; scroll?: boolean };
type Navigation = { active: Target | null; navigate: (href: string, options?: Options) => boolean; cancel: () => void; menuOpened: () => void };
const NavigationContext = createContext<Navigation | null>(null);
const LinkPendingContext = createContext<boolean | undefined>(undefined);

/** Only existing public Club routes may use this client navigation region. */
export function communityRouteTarget(href: string, origin?: string): Target | null {
  if (href.startsWith("//") || (!origin && !href.startsWith("/"))) return null;
  let url: URL;
  try { url = new URL(href, origin ?? "https://community-navigation.invalid"); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || (origin && url.origin !== origin) || url.username || url.password) return null;
  if (!/^\/en\/club(?:\/(?:artworks|creators)\/[^/]+)?\/?$/.test(url.pathname)) return null;
  return { href: `${url.pathname}${url.search}${url.hash}`, variant: /^\/en\/club\/?$/.test(url.pathname) ? "gallery" : url.pathname.includes("/artworks/") ? "artwork" : "creator" };
}

export function CommunityRouteNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<Target | null>(null);
  const menuEntry = useRef<string | null>(null);
  const cancel = useCallback(() => setTarget(null), []);
  const menuOpened = useCallback(() => { menuEntry.current = `${location.pathname}${location.search}${location.hash}`; }, []);
  useEffect(() => {
    const onPopstate = () => {
      const current = `${location.pathname}${location.search}${location.hash}`;
      const enteringMenu = Boolean(history.state?.[mobileNavigationHistoryKey]);
      const onlyConsumedMenu = menuEntry.current === current && !enteringMenu;
      menuEntry.current = enteringMenu ? current : null;
      if (!onlyConsumedMenu) cancel();
    };
    window.addEventListener("popstate", onPopstate);
    return () => window.removeEventListener("popstate", onPopstate);
  }, [cancel]);
  const navigate = useCallback((href: string, options: Options = {}) => {
    const next = communityRouteTarget(href, location.origin);
    if (!next) return false;
    const url = new URL(next.href, location.origin);
    if (url.pathname === location.pathname && url.search === location.search) return false; // Keep native same-page/hash semantics.
    setTarget(next); // A later accepted navigation replaces the earlier placeholder.
    startTransition(() => options.replace
      ? options.scroll === undefined ? router.replace(next.href) : router.replace(next.href, { scroll: options.scroll })
      : options.scroll === undefined ? router.push(next.href) : router.push(next.href, { scroll: options.scroll }));
    return true;
  }, [router]);
  return <NavigationContext.Provider value={{ active: pending ? target : null, navigate, cancel, menuOpened }}>{children}</NavigationContext.Provider>;
}

export function CommunityRoutePendingRegion({ children }: { children: ReactNode }) {
  const navigation = useContext(NavigationContext);
  // The document renders visible children. Only a hydrated navigation hides the
  // source tree; keeping it mounted preserves filters/drafts on canceled Back.
  return <><div hidden={Boolean(navigation?.active)}>{children}</div>{navigation?.active ? <CommunityLoading variant={navigation.active.variant} /> : null}</>;
}
export function useCommunityRouteNavigation() { return useContext(NavigationContext); }
export function CommunityLinkPendingScope({ pending, children }: { pending: boolean | undefined; children: ReactNode }) {
  return <LinkPendingContext.Provider value={pending}>{children}</LinkPendingContext.Provider>;
}
export function useCommunityLinkPending() { return useContext(LinkPendingContext); }
