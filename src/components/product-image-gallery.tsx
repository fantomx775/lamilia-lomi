"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";

export type ProductGalleryImage = {
  id: string;
  path: string;
  alt: string;
  caption: string | null;
  unoptimized: boolean;
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

const fullWidthGallerySizes =
  "(min-width: 1280px) 600px, (min-width: 1024px) calc(50vw - 40px), (min-width: 640px) calc(50vw - 32px), calc(50vw - 22px)";

type ProductImageGalleryProps = {
  images: ProductGalleryImage[];
  labels: ProductImageGalleryLabels;
  sizes?: string;
};

export function ProductImageGallery({
  images,
  labels,
  sizes = fullWidthGallerySizes,
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

  const visibleImages = images.slice(0, 4);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {visibleImages.map((image, index) => (
          <figure key={image.id} className="group">
            <button
              type="button"
              aria-label={
                index === 3 && imageCount > 4
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
                {index === 3 && imageCount > 4 ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 grid place-items-center bg-[rgba(44,36,32,0.55)] text-3xl font-medium tabular-nums text-white"
                  >
                    +{imageCount - 4} {labels.moreImages ?? "more"}
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
            {image.caption ? (
              <figcaption className="mt-3 px-1 text-sm leading-6 text-[var(--color-muted)]">
                {image.caption}
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
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(94vw,calc(52.5dvh_+_2.5rem))] max-w-none overflow-y-auto border-0 bg-transparent p-0 text-[var(--color-ink)] backdrop:bg-[rgba(44,36,32,0.78)] backdrop:backdrop-blur-sm"
      >
        {activeImage && activeIndex !== null ? (
          <div className="rounded-[1.5rem] border border-white/70 bg-[var(--color-bg)] p-3 shadow-[0_30px_100px_rgba(26,21,18,0.36)] sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-4 sm:mb-4">
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

            <div
              data-testid="product-gallery-preview-frame"
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              className="relative mx-auto flex w-[min(100%,52.5dvh)] max-w-[40rem] aspect-[8.5/11] touch-pan-y items-center justify-center overflow-hidden rounded-[1.1rem] border border-[var(--color-border)] bg-[var(--color-bg-alt)]"
            >
              <Image
                key={activeImage.id}
                src={activeImage.path}
                alt={activeImage.alt}
                fill
                loading="eager"
                unoptimized={activeImage.unoptimized}
                className="object-contain"
                sizes="(max-width: 768px) 90vw, 40rem"
              />

              {imageCount > 1 ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2 sm:px-4">
                  <button
                    type="button"
                    aria-label={labels.previousImage}
                    onClick={showPrevious}
                    className="pointer-events-auto grid size-10 place-items-center rounded-full border border-white/80 bg-white/92 text-[var(--color-ink)] shadow-md transition hover:scale-105 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] sm:size-11"
                  >
                    <ChevronLeft className="size-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={labels.nextImage}
                    onClick={showNext}
                    className="pointer-events-auto grid size-10 place-items-center rounded-full border border-white/80 bg-white/92 text-[var(--color-ink)] shadow-md transition hover:scale-105 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] sm:size-11"
                  >
                    <ChevronRight className="size-5" aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>

            {activeImage.caption ? (
              <p className="mt-3 px-1 text-center text-sm leading-6 text-[var(--color-muted)]">
                {activeImage.caption}
              </p>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
