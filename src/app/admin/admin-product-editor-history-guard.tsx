"use client";

import { useEffect, type ReactNode } from "react";

let activeProductEditorPopStateGuard: ((event: PopStateEvent) => void) | null = null;

export function registerProductEditorPopStateGuard(guard: (event: PopStateEvent) => void) {
  // Next may unmount the editor before the persistent layout listener receives this traversal.
  activeProductEditorPopStateGuard = guard;
}

export function AdminProductEditorHistoryGuard({ children }: { children: ReactNode }) {
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => activeProductEditorPopStateGuard?.(event);
    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, []);

  return children;
}
