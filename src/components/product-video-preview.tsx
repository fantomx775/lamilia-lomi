import { PlayCircle } from "lucide-react";

import type { ProductAsset } from "@/lib/types";

type VideoPreviewAsset = Pick<ProductAsset, "contentType" | "path" | "title">;

type ProductVideoPreviewProps = {
  video?: VideoPreviewAsset | null;
};

export function ProductVideoPreview({ video }: ProductVideoPreviewProps) {
  const playableVideo = video?.contentType.toLowerCase().startsWith("video/")
    ? video
    : null;

  return (
    <div className="relative grid min-h-72 place-items-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]">
      {playableVideo ? (
        <video
          src={playableVideo.path}
          controls
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
          aria-label={playableVideo.title ?? "Video preview"}
        />
      ) : null}
      {!playableVideo ? (
        <div className="pointer-events-none relative z-10 flex items-center gap-2 rounded-md bg-white/82 px-4 py-3 text-sm font-medium">
          <PlayCircle className="size-5 text-[var(--color-terracotta)]" />
          Public flipthrough video
        </div>
      ) : null}
    </div>
  );
}
