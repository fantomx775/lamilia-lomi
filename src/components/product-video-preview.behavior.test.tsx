/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductVideoPreview } from "./product-video-preview";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("flip-through recovery", () => {
  it("keeps intentional pause after a deferred play rejects with AbortError, then permits another play", async () => {
    let rejectPlay!: (reason: unknown) => void;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectPlay = reject; }))
      .mockResolvedValue();
    const { container } = render(<ProductVideoPreview video={{ path: "/slow.mp4", contentType: "video/mp4" }} poster="/cover.png" />);
    fireEvent.click(screen.getByTestId("product-video-play"));
    expect(screen.getByRole("status")).toHaveTextContent("Preparing video");
    fireEvent.pause(container.querySelector("video")!);
    await act(async () => rejectPlay(new DOMException("The play request was interrupted by pause", "AbortError")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByTestId("product-video-play"));
    expect(play).toHaveBeenCalledTimes(2);
    fireEvent.playing(container.querySelector("video")!);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("handles the pause AbortError before its native event, but still surfaces a real play rejection", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(new DOMException("Interrupted", "AbortError"))
      .mockRejectedValueOnce(new DOMException("Unsupported media", "NotSupportedError"));
    render(<ProductVideoPreview video={{ path: "/slow.mp4", contentType: "video/mp4" }} poster="/cover.png" />);
    fireEvent.click(screen.getByTestId("product-video-play"));
    await waitFor(() => expect(screen.getByTestId("product-video-play")).toBeVisible());
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByTestId("product-video-play"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not be played"));
  });
  it("ignores a stale pending play rejection after the source is replaced", async () => {
    let rejectPlay!: (reason: unknown) => void;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectPlay = reject; }));
    const { rerender } = render(<ProductVideoPreview video={{ path: "/old.mp4", contentType: "video/mp4" }} poster="/cover.png" />);
    fireEvent.click(screen.getByTestId("product-video-play"));
    rerender(<ProductVideoPreview video={{ path: "/new.mp4", contentType: "video/mp4" }} poster="/cover.png" />);
    await act(async () => rejectPlay(new DOMException("Source replaced", "AbortError")));
    expect(screen.getByTestId("product-video-play")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("does not let a queued old pause hide a newer genuine playback failure", async () => {
    let rejectPlay!: (reason: unknown) => void;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectPlay = reject; }));
    const { container } = render(<ProductVideoPreview video={{ path: "/new-attempt.mp4", contentType: "video/mp4" }} poster="/cover.png" />);
    const video = container.querySelector("video")!;
    fireEvent.click(screen.getByTestId("product-video-play"));
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.pause(video); // queued old event; the current attempt has already resumed
    expect(screen.getByRole("status")).toHaveTextContent("Preparing video");
    await act(async () => rejectPlay(new DOMException("Actual unsupported source", "NotSupportedError")));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be played");
  });
  it("keeps the poster until playing, prepares only on intent, and gives immediate waiting feedback", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { container } = render(<ProductVideoPreview video={{ path: "/sample.mp4", title: "upload-final720.mp4", contentType: "video/mp4" }} poster="/cover.png" />);
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("aria-label", "Inside the book: flip-through preview");
    fireEvent.click(screen.getByRole("button", { name: /Play Inside the book/ }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Preparing video");
    expect(video).toHaveAttribute("preload", "metadata");
    fireEvent.loadedData(video);
    expect(container.querySelector('img[aria-hidden="true"]')).not.toBeNull();
    fireEvent.playing(video);
    expect(container.querySelector('img[aria-hidden="true"]')).toBeNull();
    fireEvent.waiting(video);
    expect(screen.getByRole("status")).toHaveTextContent("Preparing video");
    fireEvent.playing(video);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("retains native controls and supports retry after a real player error event", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const { container } = render(<ProductVideoPreview video={{ path: "/sample.mp4", contentType: "video/mp4" }} poster="/cover.png" />);
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be played");
    fireEvent.click(screen.getByRole("button", { name: "Retry video" }));
    expect(load).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.playing(video);
    fireEvent.pause(video);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
