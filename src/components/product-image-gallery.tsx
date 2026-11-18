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
  description?: string;
  unoptimized: boolean;
  captionHref?: string;
  captionAvatar?: ReactNode;
  thumbnailAction?: ReactNode;
  thumbnailSrcSet?: string;
  detailPath?: string;
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
  const [loadedSources, setLoadedSources] = useState<Record<string, string>>({});
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openingButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const imageCount = images.length;
  const activeImage = activeIndex === null ? null : images[activeIndex];
  // Keep adjacent previews mounted so navigation can reuse their in-flight requests.
  const previewIndexes = activeIndex === null || !activeImage
    ? []
    : Array.from(new Set([
        activeIndex,
        (activeIndex + 1) % imageCount,
        (activeIndex + imageCount - 1) % imageCount,
      ]));

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
  const readerLayout = layout === "reader-artworks";
  const thumbnailGridClassName = readerLayout
    ? "grid grid-cols-2 gap-5 sm:grid-cols-2 lg:grid-cols-4"
    : layout === "inside-book"
      ? "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      : "grid grid-cols-2 gap-3 sm:gap-4";

  return (
    <>
      <div className={thumbnailGridClassName} data-testid={readerLayout ? "reader-artwork-grid" : undefined}>
        {visibleImages.map((image, index) => (
          <figure key={image.id} className={readerLayout
            ? `group min-w-0 rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-sm sm:p-3 ${imageCount === 1 ? "col-span-full w-full max-w-sm justify-self-center" : ""}`
            : "group"}>
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
                {image.thumbnailSrcSet ? (
                  // Auth-checked, no-store derivatives must not pass through a public optimizer.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image.path} srcSet={image.thumbnailSrcSet} sizes={sizes} alt={image.alt} loading="lazy" className="absolute inset-0 size-full object-contain" onLoad={({ currentTarget }) => {
                    const source = currentTarget.currentSrc || currentTarget.src;
                    setLoadedSources((current) => current[image.path] === source ? current : { ...current, [image.path]: source });
                  }} />
                ) : <Image
                  src={image.path}
                  alt={image.alt}
                  fill
                  loading="lazy"
                  unoptimized={image.unoptimized}
                  className="object-contain"
                  onLoad={({ currentTarget }) => {
                    const { currentSrc } = currentTarget;
                    if (currentSrc) {
                      setLoadedSources((current) => current[image.path] === currentSrc
                        ? current
                        : { ...current, [image.path]: currentSrc });
                    }
                  }}
                  sizes={sizes}
                />}
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
              {!readerLayout && image.thumbnailAction ? <div className="absolute bottom-3 right-3 z-10">{image.thumbnailAction}</div> : null}
            </div>
            {image.caption || image.description || (readerLayout && image.thumbnailAction) ? (
              <figcaption className={`mt-3 min-w-0 px-1 text-sm leading-6 text-[var(--color-muted)] ${readerLayout ? "grid gap-2 [overflow-wrap:anywhere]" : ""}`}>
                <div className={readerLayout ? "flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1" : undefined}>
                  {image.captionHref ? <Link href={image.captionHref} aria-label={image.captionAvatar ? image.caption ?? undefined : undefined} className={`rounded-sm font-medium text-[var(--color-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] ${readerLayout ? "inline-flex min-h-11 min-w-0 items-center gap-2" : "underline"}`}>
                    {image.captionAvatar}
                    <span className="min-w-0">{image.caption}</span>
                  </Link> : image.caption}
                  {readerLayout ? image.thumbnailAction : null}
                </div>
                {image.description ? <span className="block">{image.description}</span> : null}
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
            <div className="mb-2 flex shrink-0 items-center justify-end sm:mb-3">
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
                {previewIndexes.map((index) => {
                  const image = images[index];
                  const isActive = index === activeIndex;
                  const loadedSource = loadedSources[image.path];
                  return (
                    <GalleryPreviewImage
                      key={`${image.id}:${image.detailPath ?? image.path}`}
                      image={image}
                      thumbnail={loadedSource}
                      active={isActive}
                    />
                  );
                })}
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

            {activeImage.caption || activeImage.description ? (
              <p className={`mt-2 min-w-0 shrink-0 px-1 text-center text-sm leading-6 text-[var(--color-muted)] sm:mt-3 ${layout === "reader-artworks" ? "[overflow-wrap:anywhere]" : ""}`}>
                {activeImage.caption}
                {activeImage.description ? <span className="block">{activeImage.description}</span> : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </>
  );
}

function GalleryPreviewImage({ image, thumbnail, active }: { image: ProductGalleryImage; thumbnail?: string; active: boolean }) {
  const [decoded, setDecoded] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  const displaySource = active ? decoded ?? thumbnail : undefined;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return <div className={active ? "absolute inset-0" : "invisible absolute inset-0"} aria-hidden={!active}>
    {/* Only the active slide can reuse a thumbnail observed by its real onLoad.
        Unknown thumbnails stay neutral; neighbors request only their real detail. */}
    {displaySource ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img data-gallery-display src={displaySource} alt={image.alt} loading="eager" className="absolute inset-0 size-full object-contain" />
    ) : null}
    <Image key={attempt} src={image.detailPath ?? image.path} alt="" aria-hidden fill loading="eager"
      fetchPriority={active ? "high" : "low"} unoptimized={image.unoptimized}
      sizes="(min-width: 768px) min(75vw, calc((100dvh - 8rem) * 0.773)), min(90vw, calc((100dvh - 11rem) * 0.773))"
      className="pointer-events-none invisible object-contain"
      onLoad={async ({ currentTarget }) => {
        const source = currentTarget.currentSrc || currentTarget.src;
        try { await currentTarget.decode?.(); if (alive.current) { setDecoded(source); setFailed(false); } }
        catch { if (alive.current) setFailed(true); }
      }}
      onError={() => setFailed(true)} />
    {active && !decoded ? <div className="absolute inset-x-2 bottom-2 rounded-lg bg-white/95 p-3 text-center text-sm shadow-sm">
      {failed ? <><p role="alert">The larger preview could not be loaded. You can retry or move to another image.</p><button type="button" className="mt-2 min-h-11 rounded-md border border-[var(--color-border)] px-4 font-medium" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>Retry image</button></> : <p role="status">Loading larger preview...</p>}
    </div> : null}
  </div>;
}
