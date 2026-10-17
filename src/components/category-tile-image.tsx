"use client";

import Image from "next/image";
import { BookOpen } from "lucide-react";
import { useState } from "react";

import { isCategoryMediaProxyPath, isMediaProxyPath } from "@/lib/media-upload";

export function CategoryTileImage({ src, sizes = "56px" }: { src?: string | null; sizes?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);

  if (!src || failedSource === src) {
    return (
      <span
        aria-hidden="true"
        data-testid="category-image-fallback"
        className="grid size-full place-items-center bg-[var(--color-bg)] text-[var(--color-terracotta)]"
      >
        <span className="grid size-9 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-blush)]">
          <BookOpen className="size-5" aria-hidden />
        </span>
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt=""
      fill
      sizes={sizes}
      unoptimized={isMediaProxyPath(src) || isCategoryMediaProxyPath(src)}
      onError={() => setFailedSource(src)}
      className="object-contain p-1"
    />
  );
}
