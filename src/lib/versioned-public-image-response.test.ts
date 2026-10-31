import { afterEach, describe, expect, it, vi } from "vitest";

import { versionedPublicImageResponse } from "./versioned-public-image-response";

const source = "https://media.example.test/products/cover.webp";
const request = () => new Request("https://app.example.test/api/media/current?v=current", {
  headers: { Cookie: "private-session", Authorization: "Bearer private-token" },
});

afterEach(() => vi.unstubAllGlobals());

describe("versioned public image source streaming", () => {
  it("streams image bytes with bounded cache headers without forwarding caller credentials or upstream cache lifetime", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImage = vi.fn().mockResolvedValue(new Response(bytes, { headers: {
      "Content-Type": "image/webp; charset=binary", "Cache-Control": "public, max-age=31536000",
      ETag: '"current"', "Last-Modified": "Thu, 01 Oct 2026 12:00:00 GMT", "Set-Cookie": "upstream-secret",
    } }));
    vi.stubGlobal("fetch", fetchImage);
    const result = await versionedPublicImageResponse(request(), source);
    expect(result?.status).toBe(200);
    expect(new Uint8Array(await result!.arrayBuffer())).toEqual(bytes);
    expect(result?.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(result?.headers.get("content-type")).toBe("image/webp");
    expect(result?.headers.get("etag")).toBe('"current"');
    expect(result?.headers.get("last-modified")).toBe("Thu, 01 Oct 2026 12:00:00 GMT");
    expect(result?.headers.get("set-cookie")).toBeNull();
    expect(fetchImage.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", redirect: "error", signal: expect.any(AbortSignal) });
    expect(fetchImage.mock.calls[0]?.[1].headers).toBeUndefined();
  });

  it.each([404, 410])("reports a missing/removed source (%s) without image bytes", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("removed", { status })));
    expect(await versionedPublicImageResponse(request(), source)).toBeNull();
  });

  it.each([
    { status: 200, type: "text/html" },
    { status: 403, type: "image/webp" },
    { status: 503, type: "image/webp" },
    { status: 302, type: "image/webp" },
  ])("rejects a non-image or unsuccessful upstream response (%s)", async ({ status, type }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status, headers: { "Content-Type": type } })));
    await expect(versionedPublicImageResponse(request(), source)).rejects.toThrow("unsupported content type");
  });

  it("rejects an insecure source before fetching", async () => {
    const fetchImage = vi.fn();
    vi.stubGlobal("fetch", fetchImage);
    await expect(versionedPublicImageResponse(request(), "http://media.example.test/cover.webp")).rejects.toThrow("source request failed");
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("combines caller cancellation with a ten-second source timeout", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchImage = vi.fn().mockImplementation(async (_url, options) => {
      expect(timeout).toHaveBeenCalledWith(10_000);
      expect(options.signal.aborted).toBe(false);
      controller.abort();
      expect(options.signal.aborted).toBe(true);
      throw new Error("private upstream details");
    });
    vi.stubGlobal("fetch", fetchImage);
    try {
      await expect(versionedPublicImageResponse(new Request("https://app.example.test/image", { signal: controller.signal }), source))
        .rejects.toThrow("The public image source request failed.");
    } finally { timeout.mockRestore(); }
  });
});
