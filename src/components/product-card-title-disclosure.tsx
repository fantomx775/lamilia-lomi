"use client";

import { useEffect, useRef, useState } from "react";

export function ProductCardTitleDisclosure({ title }: { title: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [isTitleTruncated, setIsTitleTruncated] = useState(false);

  useEffect(() => {
    const heading = anchorRef.current?.closest("article")?.querySelector<HTMLHeadingElement>("[data-product-card-title]");
    if (!heading) return;

    let active = true;
    const updateTruncation = () => {
      if (!active) return;
      setIsTitleTruncated(heading.scrollHeight > heading.clientHeight + 1);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateTruncation);

    resizeObserver?.observe(heading);
    window.addEventListener("resize", updateTruncation);
    updateTruncation();
    void document.fonts?.ready.then(updateTruncation);

    return () => {
      active = false;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateTruncation);
    };
  }, [title]);

  return (
    <>
      <span hidden ref={anchorRef} />
      {isTitleTruncated && (
        <details className="rounded-b-lg border-t border-[var(--color-border)] bg-white/70 px-3 sm:px-4">
          <summary className="cursor-pointer py-2 text-xs font-medium text-[var(--color-terracotta)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">
            Read full title
          </summary>
          <p className="[overflow-wrap:anywhere] pb-3 text-sm font-medium text-[var(--color-ink)]" data-testid="full-product-title">
            {title}
          </p>
        </details>
      )}
    </>
  );
}
