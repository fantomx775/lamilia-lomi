"use client";

import Image from "next/image";
import { ImageOff } from "lucide-react";
import { useState } from "react";

import { isCategoryMediaProxyPath, isMediaProxyPath } from "@/lib/media-upload";

export function ImageWithFallback({
  src,
  alt,
  sizes,
  className,
  loading = "lazy",
}: {
  src?: string | null;
  alt: string;
  sizes?: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === src;

  if (!src || failed) {
    return (
      <span role="img" aria-label={`${alt} — brak obrazu`} className={`grid place-items-center text-[var(--color-muted)] ${className ?? ""}`}>
        <ImageOff className="size-7" aria-hidden />
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes ?? "(min-width: 768px) 25vw, 50vw"}
      loading={loading}
      unoptimized={isMediaProxyPath(src) || isCategoryMediaProxyPath(src)}
      onError={() => setFailedSource(src)}
      className={className}
    />
  );
}
