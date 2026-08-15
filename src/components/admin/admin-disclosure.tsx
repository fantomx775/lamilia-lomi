import { useRef, useState, type MouseEvent } from "react";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function AdminDisclosure({
  summary,
  children,
  className,
  contentClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggle = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (isOpen) {
      setIsOpen(false);
      if (reducedMotion) {
        setIsDetailsOpen(false);
      } else {
        closeTimerRef.current = setTimeout(() => {
          setIsDetailsOpen(false);
          closeTimerRef.current = null;
        }, 180);
      }
      return;
    }

    setIsDetailsOpen(true);
    if (reducedMotion) {
      setIsOpen(true);
    } else {
      setTimeout(() => setIsOpen(true), 0);
    }
  };

  return (
    <details
      className={cn("admin-disclosure", className)}
      open={isDetailsOpen}
      data-state={isOpen ? "open" : "closed"}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold"
        aria-expanded={isOpen}
        onClick={handleToggle}
      >
        <span className="min-w-0">{summary}</span>
        <ChevronDown className="admin-disclosure-chevron size-4 shrink-0" aria-hidden />
      </summary>
      <div
        className={cn("admin-disclosure-content", contentClassName)}
        style={{ maxHeight: isOpen ? "120rem" : "0px", opacity: isOpen ? 1 : 0 }}
      >
        <div>{children}</div>
      </div>
    </details>
  );
}
