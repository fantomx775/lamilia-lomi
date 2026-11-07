import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dangerouslyDeleteBySrcImage } from "@vercel/functions";

import { hasProductImageCachePurge, purgeProductImageCache } from "./product-image-cache";

vi.mock("server-only", () => ({}));
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteBySrcImage: vi.fn() }));

const storagePath = "products/product/gallery/a page.webp";
const publicUrl = "https://media.example.test/products/product/gallery/a%20page.webp";

describe("public product image cache purge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PRODUCT_IMAGE_CLOUDFLARE_PURGE_TOKEN", "cf-token");
    vi.stubEnv("PRODUCT_IMAGE_CLOUDFLARE_ZONE_ID", "zone");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("purges the deleted public object before deleting both Vercel source keys", async () => {
    const fetchPurge = vi.fn().mockResolvedValue(Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchPurge);

    await purgeProductImageCache("image", storagePath);

    expect(fetchPurge).toHaveBeenNthCalledWith(1, "https://api.cloudflare.com/client/v4/zones/zone/purge_cache",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ files: [publicUrl] }) }));
    expect(dangerouslyDeleteBySrcImage).toHaveBeenCalledWith(["/api/media/image?v=image", publicUrl]);
  });

  it("leaves the shared public source cached when another image still uses it", async () => {
    const fetchPurge = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchPurge);

    await purgeProductImageCache("image");

    expect(fetchPurge).not.toHaveBeenCalled();
    expect(dangerouslyDeleteBySrcImage).toHaveBeenCalledWith(["/api/media/image?v=image"]);
  });

  it("fails the revocation on a provider rejection", async () => {
    const fetchPurge = vi.fn().mockResolvedValue(Response.json({ success: false }));
    vi.stubGlobal("fetch", fetchPurge);

    await expect(purgeProductImageCache("image", storagePath)).rejects.toThrow("Cloudflare product image cache purge failed");
    expect(fetchPurge).toHaveBeenCalledTimes(1);
    expect(dangerouslyDeleteBySrcImage).not.toHaveBeenCalled();
  });

  it("requires both providers before using extended caching", async () => {
    vi.stubEnv("PRODUCT_IMAGE_CLOUDFLARE_PURGE_TOKEN", "");
    const fetchPurge = vi.fn();
    vi.stubGlobal("fetch", fetchPurge);

    expect(hasProductImageCachePurge()).toBe(false);
    await purgeProductImageCache("image", storagePath);
    expect(fetchPurge).not.toHaveBeenCalled();
    expect(dangerouslyDeleteBySrcImage).not.toHaveBeenCalled();
  });
});
