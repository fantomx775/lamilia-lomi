"use client";

import { useEffect, type ReactNode } from "react";

type ProductEditorPopStateGuard = (event: PopStateEvent) => void;

const productEditorPopStateGuards = new Map<symbol, ProductEditorPopStateGuard>();

export function registerProductEditorPopStateGuard(guard: (event: PopStateEvent) => void) {
  // Next may unmount the editor before the persistent layout listener receives this traversal.
  const registration = Symbol("product-editor-popstate-guard");
  productEditorPopStateGuards.set(registration, guard);

  return () => {
    productEditorPopStateGuards.delete(registration);
  };
}

export function AdminProductEditorHistoryGuard({ children }: { children: ReactNode }) {
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      let activeGuard: ProductEditorPopStateGuard | undefined;
      for (const guard of productEditorPopStateGuards.values()) activeGuard = guard;
      activeGuard?.(event);
    };

    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, []);

  return children;
}
