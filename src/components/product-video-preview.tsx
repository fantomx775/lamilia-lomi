import { PlayCircle } from "lucide-react";

import type { ProductAsset } from "@/lib/types";

type VideoPreviewAsset = Pick<ProductAsset, "contentType" | "path" | "title">;

type ProductVideoPreviewProps = {
  video?: VideoPreviewAsset | null;
  label?: string;
};

export function ProductVideoPreview({
  video,
  label = "Flip-through · 8 sec",
}: ProductVideoPreviewProps) {
  const playableVideo = video?.contentType.toLowerCase().startsWith("video/")
    ? video
    : null;

  return (
    <figure className="group">
      <div className="relative aspect-video overflow-hidden rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-bg-alt)] shadow-[0_16px_40px_rgba(62,52,47,0.08)]">
        {playableVideo ? (
          <video
            src={playableVideo.path}
            controls
            preload="metadata"
            playsInline
            className="absolute inset-0 size-full object-cover"
            aria-label={playableVideo.title ?? "Video preview"}
          >
            Your browser does not support the video tag.
          </video>
        ) : null}
        {!playableVideo ? (
          <div className="absolute inset-0 grid place-items-center">
            <PlayCircle
              className="size-12 text-[var(--color-terracotta)]"
              strokeWidth={1.4}
              aria-hidden
            />
          </div>
        ) : null}
        <span className="absolute left-4 top-4 rounded-full border border-white/70 bg-white/82 px-3 py-1.5 text-xs font-medium tracking-[0.08em] text-[var(--color-ink-soft)] shadow-sm backdrop-blur-sm">
          {label}
        </span>
      </div>
    </figure>
  );
}
