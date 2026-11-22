"use client";

import { getImageProps } from "next/image";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { isMediaProxyPath } from "@/lib/media-upload";
import { publicImageAlt } from "@/lib/product-display";
import { isPlayableVideoAsset, type VideoPreviewAsset } from "@/lib/product-video";

type ProductVideoPreviewProps = {
  video?: VideoPreviewAsset | null;
  poster: string;
};

export function ProductVideoPreview({
  video,
  poster,
}: ProductVideoPreviewProps) {
  const playableVideo = isPlayableVideoAsset(video) ? video : null;

  if (!playableVideo) {
    return null;
  }

  const { props: { src: posterSrc } } = getImageProps({
    src: poster,
    alt: "",
    width: 384,
    height: 497,
    unoptimized: isMediaProxyPath(poster),
  });

  return (
    <VideoPlayer key={playableVideo.path} video={playableVideo} posterSrc={posterSrc} />
  );
}

function VideoPlayer({ video, posterSrc }: { video: VideoPreviewAsset; posterSrc: string }) {
  const player = useRef<HTMLVideoElement>(null);
  const alive = useRef(true);
  const playbackGeneration = useRef(0);
  const [prepared, setPrepared] = useState(false);
  const [started, setStarted] = useState(false);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused" | "waiting" | "error">("idle");
  const [slow, setSlow] = useState(false);
  const label = publicImageAlt(video.title, "Inside the book: flip-through preview");
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; playbackGeneration.current += 1; };
  }, []);
  const prepare = () => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (!connection?.saveData) setPrepared(true);
  };
  useEffect(() => {
    const element = player.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
        if (!connection?.saveData) setPrepared(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (state !== "loading" && state !== "waiting") return;
    const timer = window.setTimeout(() => setSlow(true), 20000);
    return () => { window.clearTimeout(timer); setSlow(false); };
  }, [state]);
  async function play(retry = false) {
    let element = player.current;
    if (!element) return;
    const generation = ++playbackGeneration.current;
    if (retry) {
      // WebKit can keep an errored native media element stalled after load()+play(),
      // even when the retried Storage response is complete. Replace only that
      // element and start its new ref synchronously within the Retry gesture.
      flushSync(() => {
        setPrepared(true);
        setState("loading");
        setRetryGeneration((current) => current + 1);
      });
      element = player.current;
      if (!element) return;
    } else {
      setPrepared(true);
      setState("loading");
    }
    try { await element.play(); }
    catch (cause) {
      if (!alive.current || player.current !== element || generation !== playbackGeneration.current) return;
      // pause()/load() deliberately reject a pending play promise with AbortError.
      // The rejection can arrive before the queued native pause event.
      const interrupted = cause instanceof DOMException && cause.name === "AbortError" && element.paused;
      setState(interrupted ? "paused" : "error");
    }
  }
  return (
    <figure className="group">
      <div onPointerEnter={prepare} onFocus={prepare} className="relative aspect-video overflow-hidden rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-bg-alt)] shadow-[0_16px_40px_rgba(62,52,47,0.08)]">
        <video
          key={retryGeneration}
          ref={player}
          data-flipthrough
          src={video.path}
          poster={posterSrc}
          controls
          preload={prepared ? "metadata" : "none"}
          playsInline
          className="absolute inset-0 size-full object-contain"
          aria-label={label}
          onPlay={() => setState("loading")}
          onPlaying={() => { setStarted(true); setState("playing"); }}
          onWaiting={() => setState("waiting")}
          onStalled={() => setState("waiting")}
          onPause={(event) => {
            // A queued pause from load()/an earlier attempt can arrive after a
            // newer play() already resumed this same native element.
            if (!event.currentTarget.paused) return;
            playbackGeneration.current += 1;
            setState((current) => current === "error" ? current : "paused");
          }}
          onEnded={() => { playbackGeneration.current += 1; setState("paused"); }}
          onError={() => { playbackGeneration.current += 1; setState("error"); }}
        >
          Your browser does not support the video tag.
        </video>
        {!started ? <>
          {/* The cover remains until actual playing, never just metadata/loadeddata. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={posterSrc} alt="" aria-hidden className="pointer-events-none absolute inset-0 size-full object-contain" />
          {state === "idle" || state === "paused" ? <button type="button" data-testid="product-video-play" onClick={() => { void play(); }} className="absolute left-1/2 top-1/2 min-h-11 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-6 py-3 font-semibold text-[var(--color-ink)] shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4" aria-label={`Play ${label}`}>Play preview</button> : null}
        </> : null}
        {state === "loading" || state === "waiting" ? <div className="pointer-events-none absolute inset-x-3 top-3 rounded-lg bg-white/95 p-3 text-center text-sm shadow-sm" role="status">{slow ? "This is taking longer than usual. Check your connection or retry." : "Preparing video..."}</div> : null}
        {state === "loading" || state === "waiting" ? <button type="button" data-testid="product-video-pause" className="absolute bottom-12 left-1/2 min-h-11 -translate-x-1/2 rounded-md bg-white px-4 font-medium shadow-sm" onClick={() => {
          playbackGeneration.current += 1;
          player.current?.pause();
          setState("paused");
        }}>Pause preview</button> : null}
        {state === "error" || slow ? <div className="absolute inset-x-3 bottom-12 rounded-lg bg-white/95 p-3 text-center text-sm shadow-sm">
          {state === "error" ? <p role="alert">The video could not be played. Please check your connection and retry.</p> : null}
          <button type="button" className="mt-2 min-h-11 rounded-md border border-[var(--color-border)] px-4 font-medium" onClick={() => { setSlow(false); void play(true); }}>Retry video</button>
        </div> : null}
      </div>
      <figcaption className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{label}</figcaption>
    </figure>
  );
}
