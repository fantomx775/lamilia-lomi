import type { ProductAsset } from "@/lib/types";

type VideoPreviewAsset = Pick<ProductAsset, "contentType" | "path" | "title">;

type ProductVideoPreviewProps = {
  video?: VideoPreviewAsset | null;
  poster: string;
};

export function ProductVideoPreview({
  video,
  poster,
}: ProductVideoPreviewProps) {
  const playableVideo = video?.contentType.toLowerCase().startsWith("video/")
    ? video
    : null;

  if (!playableVideo) {
    return null;
  }

  return (
    <figure className="group">
      <div className="relative aspect-video overflow-hidden rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-bg-alt)] shadow-[0_16px_40px_rgba(62,52,47,0.08)]">
        <video
          src={playableVideo.path}
          poster={poster}
          controls
          preload="none"
          playsInline
          className="absolute inset-0 size-full object-contain"
          aria-label={playableVideo.title ?? "Video preview"}
        >
          Your browser does not support the video tag.
        </video>
      </div>
    </figure>
  );
}
