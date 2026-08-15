"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

function getAdminPathDepth(pathname: string) {
  return pathname.split("/").filter(Boolean).length;
}

type TransitionDirection = "forward" | "back";
const HISTORY_INDEX_KEY = "__lamiliaAdminHistoryIndex";

function getTransitionDirection(previousPathname: string, pathname: string): TransitionDirection {
  if (getAdminPathDepth(pathname) < getAdminPathDepth(previousPathname)) {
    return "back";
  }

  return "forward";
}

export type RouteHistory = {
  paths: string[];
  index: number;
};

export function getHistoryTarget(
  history: RouteHistory,
  pathname: string,
  storedIndex?: number,
): { index: number; direction: TransitionDirection } | null {
  const targetIndex = getTargetIndex(history, pathname, storedIndex);

  if (targetIndex === -1 || targetIndex === history.index) {
    return null;
  }

  return {
    index: targetIndex,
    direction: targetIndex < history.index ? "back" : "forward",
  };
}

function getTargetIndex(history: RouteHistory, pathname: string, storedIndex?: number) {
  if (
    storedIndex !== undefined &&
    storedIndex >= 0 &&
    storedIndex < history.paths.length &&
    history.paths[storedIndex] === pathname
  ) {
    return storedIndex;
  }

  const nextIndex = history.paths.findIndex(
    (path, index) => index > history.index && path === pathname,
  );

  if (nextIndex !== -1) {
    return nextIndex;
  }

  for (let index = history.index - 1; index >= 0; index -= 1) {
    if (history.paths[index] === pathname) {
      return index;
    }
  }

  return -1;
}

function getStoredHistoryIndex() {
  const storedIndex = window.history.state?.[HISTORY_INDEX_KEY];
  return typeof storedIndex === "number" ? storedIndex : undefined;
}

function storeHistoryIndex(index: number) {
  window.history.replaceState(
    { ...(window.history.state ?? {}), [HISTORY_INDEX_KEY]: index },
    "",
    window.location.href,
  );
}

export function AdminPageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const routeHistoryRef = useRef<RouteHistory>({ paths: [pathname], index: 0 });
  const recordedPathnameRef = useRef(pathname);
  const [pendingHistory, setPendingHistory] = useState<{
    pathname: string;
    direction: TransitionDirection;
    targetIndex: number | null;
  } | null>(null);
  const [transition, setTransition] = useState({
    pathname,
    direction: "forward" as TransitionDirection,
  });

  useEffect(() => {
    storeHistoryIndex(routeHistoryRef.current.index);

    const handlePopState = () => {
      const targetPathname = window.location.pathname;
      const target = getHistoryTarget(
        routeHistoryRef.current,
        targetPathname,
        getStoredHistoryIndex(),
      );
      setPendingHistory({
        pathname: targetPathname,
        direction: target?.direction ?? "back",
        targetIndex: target?.index ?? null,
      });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const pendingDirection = pendingHistory?.pathname === pathname ? pendingHistory.direction : null;
  const nextDirection = pendingDirection ?? getTransitionDirection(transition.pathname, pathname);

  if (transition.pathname !== pathname) {
    setTransition({ pathname, direction: nextDirection });
  }

  const direction = transition.pathname === pathname ? transition.direction : nextDirection;

  useEffect(() => {
    if (recordedPathnameRef.current === pathname) {
      return;
    }

    const history = routeHistoryRef.current;
    const isHistoryNavigation = pendingHistory?.pathname === pathname;
    const targetIndex = pendingHistory?.targetIndex;

    if (isHistoryNavigation && targetIndex !== null && targetIndex !== undefined) {
      history.index = targetIndex;
    } else {
      history.paths = [...history.paths.slice(0, history.index + 1), pathname];
      history.index = history.paths.length - 1;
    }

    storeHistoryIndex(history.index);
    recordedPathnameRef.current = pathname;
  }, [pathname, pendingHistory]);

  return (
    <div
      key={pathname}
      data-direction={direction}
      className={cn("admin-page-transition", className)}
    >
      {children}
    </div>
  );
}
