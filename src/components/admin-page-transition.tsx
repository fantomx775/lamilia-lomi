"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

function getAdminPathDepth(pathname: string) {
  return pathname.split("/").filter(Boolean).length;
}

type TransitionDirection = "forward" | "back";

function getTransitionDirection(previousPathname: string, pathname: string): TransitionDirection {
  if (getAdminPathDepth(pathname) < getAdminPathDepth(previousPathname)) {
    return "back";
  }

  return "forward";
}

function getHistoryDirection(history: RouteHistory, pathname: string): TransitionDirection | null {
  const targetIndex = history.paths.indexOf(pathname);

  if (targetIndex === -1 || targetIndex === history.index) {
    return null;
  }

  return targetIndex < history.index ? "back" : "forward";
}

type RouteHistory = {
  paths: string[];
  index: number;
};

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
  } | null>(null);
  const [transition, setTransition] = useState({
    pathname,
    direction: "forward" as TransitionDirection,
  });

  useEffect(() => {
    const handlePopState = () => {
      const targetPathname = window.location.pathname;
      const direction = getHistoryDirection(routeHistoryRef.current, targetPathname) ?? "back";
      setPendingHistory({ pathname: targetPathname, direction });
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
    const targetIndex = history.paths.indexOf(pathname);

    if (isHistoryNavigation && targetIndex >= 0) {
      history.index = targetIndex;
    } else {
      history.paths = [...history.paths.slice(0, history.index + 1), pathname];
      history.index = history.paths.length - 1;
    }

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
