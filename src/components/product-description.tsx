"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import styles from "./product-description.module.css";

type ProductDescriptionProps = {
  children: ReactNode;
  previewText: string;
  readMore: string;
  showLess: string;
};

const PREVIEW_HEIGHT = 168;

export function ProductDescription({ children, previewText, readMore, showLess }: ProductDescriptionProps) {
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLParagraphElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isMeasured, setIsMeasured] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [previewHeight, setPreviewHeight] = useState(PREVIEW_HEIGHT);
  const collapsed = isMeasured && hasOverflow && !expanded;
  const excerpt = previewText.trim().replace(/\s+/g, " ");
  const preview = excerpt.length > 180 ? `${excerpt.slice(0, 180).trimEnd()}…` : excerpt;

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const measure = () => {
      const fullHeight = content.scrollHeight;
      setContentHeight(fullHeight);
      setPreviewHeight(previewRef.current?.scrollHeight || PREVIEW_HEIGHT);
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
  }, [children, collapsed, preview]);

  return (
    <div className={styles.root}>
      <div
        id={descriptionId}
        className={styles.clip}
        data-collapsed={collapsed}
        style={{ height: isMeasured && hasOverflow ? (collapsed ? previewHeight : contentHeight) : undefined }}
      >
        {collapsed ? <p ref={previewRef} className={styles.preview}>{preview}</p> : null}
        <div ref={contentRef} className={styles.content} data-hidden={collapsed} inert={collapsed} aria-hidden={collapsed ? true : undefined}>
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
