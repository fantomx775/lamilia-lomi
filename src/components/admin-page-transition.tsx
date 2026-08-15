"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

function getAdminPathDepth(pathname: string) {
  return pathname.split("/").filter(Boolean).length;
}

function getTransitionDirection(previousPathname: string, pathname: string) {
  if (getAdminPathDepth(pathname) < getAdminPathDepth(previousPathname)) {
    return "back";
  }

  return "forward";
}

export function AdminPageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const [transition, setTransition] = useState({
    pathname,
    direction: "forward",
  });
  if (transition.pathname !== pathname) {
    setTransition({
      pathname,
      direction: getTransitionDirection(transition.pathname, pathname),
    });
  }
  const direction = transition.pathname === pathname ? transition.direction : "forward";

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
