"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import styles from "./product-description.module.css";

type ProductDescriptionProps = {
  children: ReactNode;
  readMore: string;
  showLess: string;
};

const PREVIEW_HEIGHT = 168;

export function ProductDescription({ children, readMore, showLess }: ProductDescriptionProps) {
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isMeasured, setIsMeasured] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const measure = () => {
      const fullHeight = content.scrollHeight;
      setContentHeight(fullHeight);
      setHasOverflow(fullHeight > PREVIEW_HEIGHT + 1);
      setIsMeasured(true);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children]);

  return (
    <div className={styles.root}>
      <div
        id={descriptionId}
        className={styles.clip}
        data-collapsed={!expanded && hasOverflow}
        style={{ maxHeight: expanded ? contentHeight : PREVIEW_HEIGHT }}
        inert={!expanded && (!isMeasured || hasOverflow)}
        aria-hidden={!expanded && hasOverflow}
      >
        <div ref={contentRef} className={styles.content}>
          {children}
        </div>
      </div>
      {hasOverflow ? (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.toggle}
            aria-controls={descriptionId}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? showLess : readMore}
          </button>
        </div>
      ) : null}
    </div>
  );
}
