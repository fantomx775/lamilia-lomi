"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import type { ReactNode } from "react";

export type ProductGalleryImage = {
  id: string;
  path: string;
  alt: string;
  caption: string | null;
  unoptimized: boolean;
  captionHref?: string;
  thumbnailAction?: ReactNode;
};

export type ProductImageGalleryLabels = {
  openImages: string[];
  previewTitle: string;
  closePreview: string;
  previousImage: string;
  nextImage: string;
  imagePositions: string[];
  moreImages?: string;
  viewAllImages?: string;
};

type ProductImageGalleryProps = {
  images: ProductGalleryImage[];
  labels: ProductImageGalleryLabels;
  layout?: "default" | "reader-artworks" | "inside-book";
  visibleLimit?: number;
  sizes?: string;
};

export function ProductImageGallery({
  images,
  labels,
  layout = "default",
  visibleLimit = 4,
  sizes = "(min-width: 1280px) 600px, (min-width: 1024px) calc(50vw - 40px), (min-width: 640px) calc(50vw - 32px), calc(50vw - 22px)",
}: ProductImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openingButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const imageCount = images.length;
  const activeImage = activeIndex === null ? null : images[activeIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (activeIndex === null) {
      if (dialog.open) dialog.close();
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
      closeButtonRef.current?.focus();
    }
  }, [activeIndex]);

  useEffect(() => {
    if (activeIndex === null || imageCount < 2) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveIndex((current) =>
          current === null ? current : (current + imageCount - 1) % imageCount,
        );
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setActiveIndex((current) =>
          current === null ? current : (current + 1) % imageCount,
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, imageCount]);

  const showPrevious = () => {
    setActiveIndex((current) =>
      current === null || imageCount < 2
        ? current
        : (current + imageCount - 1) % imageCount,
    );
  };

  const showNext = () => {
    setActiveIndex((current) =>
      current === null || imageCount < 2 ? current : (current + 1) % imageCount,
    );
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== "touch" ||
      (event.target instanceof Element && event.target.closest("button"))
    ) {
      return;
    }

    touchStartX.current = event.clientX;
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || touchStartX.current === null) return;

    const deltaX = event.clientX - touchStartX.current;
    touchStartX.current = null;

    if (Math.abs(deltaX) < 48 || imageCount < 2) return;
    if (deltaX < 0) showNext();
    else showPrevious();
  };

  if (imageCount === 0) return null;

  const thumbnailLimit = Math.max(1, Math.min(visibleLimit, images.length));
  const visibleImages = images.slice(0, thumbnailLimit);
  const thumbnailGridClassName = layout === "reader-artworks"
    ? "grid grid-cols-2 gap-5 sm:grid-cols-2 lg:grid-cols-4"
    : layout === "inside-book"
      ? "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      : "grid grid-cols-2 gap-3 sm:gap-4";

  return (
    <>
      <div className={thumbnailGridClassName} data-testid={layout === "reader-artworks" ? "reader-artwork-grid" : undefined}>
        {visibleImages.map((image, index) => (
          <figure key={image.id} className="group">
            <div className="relative">
              <button
              type="button"
              aria-label={
                index === thumbnailLimit - 1 && imageCount > thumbnailLimit
                  ? `${labels.openImages[index] ?? labels.previewTitle}, ${(labels.viewAllImages ?? labels.previewTitle).replace("{count}", String(imageCount))}`
                  : labels.openImages[index] ?? labels.previewTitle
              }
              onClick={(event) => {
                openingButtonRef.current = event.currentTarget;
                setActiveIndex(index);
              }}
              className="group block w-full rounded-[1.25rem] text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-terracotta)]"
            >
              <span className="relative block aspect-[8.5/11] overflow-hidden rounded-[1.25rem] border border-[var(--color-border)] bg-white shadow-[0_16px_40px_rgba(62,52,47,0.08)]">
                <Image
                  src={image.path}
                  alt={image.alt}
                  fill
                  loading="lazy"
                  unoptimized={image.unoptimized}
                  className="object-contain"
                  sizes={sizes}
                />
                {index === thumbnailLimit - 1 && imageCount > thumbnailLimit ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 grid place-items-center bg-[rgba(44,36,32,0.55)] text-3xl font-medium tabular-nums text-white"
                  >
                    +{imageCount - thumbnailLimit} {labels.moreImages ?? "more"}
                  </span>
                ) : null}
                <span
                  aria-hidden
                  className="absolute right-3 top-3 grid size-9 place-items-center rounded-full border border-white/80 bg-white/90 text-[var(--color-ink-soft)] shadow-sm transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100"
                >
                  <Maximize2 className="size-4" strokeWidth={1.7} />
                </span>
              </span>
              </button>
              {image.thumbnailAction ? <div className="absolute bottom-3 right-3 z-10">{image.thumbnailAction}</div> : null}
            </div>
            {image.caption ? (
              <figcaption className={`mt-3 min-w-0 px-1 text-sm leading-6 text-[var(--color-muted)] ${layout === "reader-artworks" ? "[overflow-wrap:anywhere]" : ""}`}>
                {image.captionHref ? <Link href={image.captionHref} className="font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">{image.caption}</Link> : image.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>

      <dialog
        ref={dialogRef}
        aria-label={labels.previewTitle}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;

          const dialog = event.currentTarget;
          const focusableElements = Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter(
            (element) =>
              !element.hidden &&
              element.getAttribute("aria-hidden") !== "true" &&
              getComputedStyle(element).visibility !== "hidden" &&
              getComputedStyle(element).display !== "none",
          );

          if (focusableElements.length === 0) return;

          const first = focusableElements[0];
          const last = focusableElements[focusableElements.length - 1];
          const activeElement = document.activeElement;
          const isAtBoundary = event.shiftKey
            ? activeElement === first || !dialog.contains(activeElement)
            : activeElement === last || !dialog.contains(activeElement);

          if (!isAtBoundary) return;

          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }}
        onClose={() => {
          setActiveIndex(null);
          openingButtonRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
        className="fixed inset-0 m-0 h-dvh w-screen max-h-none max-w-none overflow-hidden border-0 bg-transparent p-[max(env(safe-area-inset-top),0.75rem)_max(env(safe-area-inset-right),0.75rem)_max(env(safe-area-inset-bottom),0.75rem)_max(env(safe-area-inset-left),0.75rem)] text-[var(--color-ink)] backdrop:bg-[rgba(44,36,32,0.78)] backdrop:backdrop-blur-sm"
      >
        {activeImage && activeIndex !== null ? (
          <div className="mx-auto flex h-full w-full max-w-[110rem] flex-col rounded-[1.5rem] border border-white/70 bg-[var(--color-bg)] p-3 shadow-[0_30px_100px_rgba(26,21,18,0.36)] sm:p-5">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-4 sm:mb-3">
              <p className="min-w-0 truncate text-sm font-medium tracking-wide text-[var(--color-ink-soft)]">
                {labels.previewTitle}
              </p>
              <div className="flex shrink-0 items-center gap-3">
                <p
                  aria-live="polite"
                  className="text-xs tabular-nums text-[var(--color-muted)] sm:text-sm"
                >
                  {labels.imagePositions[activeIndex]}
                </p>
                <button
                  type="button"
                  ref={closeButtonRef}
                  aria-label={labels.closePreview}
                  onClick={() => dialogRef.current?.close()}
                  className="grid size-11 place-items-center rounded-full border border-[var(--color-border)] bg-white/90 text-[var(--color-ink)] transition hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)_auto] items-center justify-items-center gap-2 md:grid-cols-[minmax(3rem,1fr)_auto_minmax(3rem,1fr)] md:grid-rows-1 md:gap-4">
              <div
                data-testid="product-gallery-preview-frame"
                data-gallery-image-frame
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                className="relative col-span-2 row-start-1 mx-auto flex h-[min(76dvh,calc(100dvh-11rem))] max-h-full w-[min(90vw,calc((100dvh-11rem)*0.773))] max-w-full min-h-0 shrink touch-pan-y items-center justify-center overflow-hidden rounded-[1.1rem] border border-[var(--color-border)] bg-[var(--color-bg-alt)] md:col-span-1 md:col-start-2 md:h-[min(86dvh,calc(100dvh-8rem))] md:w-[min(75vw,calc((100dvh-8rem)*0.773))]"
              >
                <Image
                  src={activeImage.path}
                  alt={activeImage.alt}
                  fill
                  loading="eager"
                  unoptimized={activeImage.unoptimized}
                  className="object-contain"
                  sizes="(max-width: 768px) 90vw, 40rem"
                />
              </div>

              {imageCount > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label={labels.previousImage}
                    data-gallery-previous
                    onClick={showPrevious}
                    className="col-start-1 row-start-2 grid size-11 place-items-center rounded-full border border-[var(--color-border)] bg-white/95 text-[var(--color-ink)] shadow-sm transition-colors hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] motion-reduce:transition-none md:col-start-1 md:row-start-1"
                  >
                    <ChevronLeft className="size-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={labels.nextImage}
                    data-gallery-next
                    onClick={showNext}
                    className="col-start-2 row-start-2 grid size-11 place-items-center rounded-full border border-[var(--color-border)] bg-white/95 text-[var(--color-ink)] shadow-sm transition-colors hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] motion-reduce:transition-none md:col-start-3 md:row-start-1"
                  >
                    <ChevronRight className="size-5" aria-hidden />
                  </button>
                </>
              ) : null}
            </div>

            {activeImage.caption ? (
              <p className={`mt-2 min-w-0 shrink-0 px-1 text-center text-sm leading-6 text-[var(--color-muted)] sm:mt-3 ${layout === "reader-artworks" ? "[overflow-wrap:anywhere]" : ""}`}>
                {activeImage.caption}
              </p>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
