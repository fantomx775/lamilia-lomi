import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  getBackendMode: vi.fn(),
  getPublicContentSnapshot: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/content-repository", () => ({
  getPublicContentSnapshot: mocks.getPublicContentSnapshot,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));

import { GET } from "./route";

const categoryId = "11111111-1111-4111-8111-111111111111";
const oldImageId = "22222222-2222-4222-8222-222222222222";
const currentImageId = "33333333-3333-4333-8333-333333333333";
const storagePath =
  "categories/" + categoryId + "/image/" + currentImageId + "-books.webp";

function mockCurrentImage(imageId: string | null, provider = "r2_public") {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: imageId
      ? {
          image_asset_id: imageId,
          image_storage_path: storagePath.replace(currentImageId, imageId),
          image_storage_provider: provider,
        }
      : {
          image_asset_id: null,
          image_storage_path: null,
          image_storage_provider: null,
        },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  mocks.createServiceRoleClient.mockReturnValue({ from });
}

async function getImage(requestedImageId: string) {
  return GET(
    new Request(
      "https://www.lamilialomi.com/api/category-media/" +
        categoryId +
        "?v=" +
        requestedImageId,
    ),
    { params: Promise.resolve({ categoryId }) },
  );
}

async function getLegacyImage() {
  return GET(
    new Request("https://www.lamilialomi.com/api/category-media/" + categoryId),
    { params: Promise.resolve({ categoryId }) },
  );
}

describe("category media version route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com");
    mocks.getBackendMode.mockReturnValue("supabase");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects an old image version after category replacement", async () => {
    mockCurrentImage(currentImageId);

    const response = await getImage(oldImageId);

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects an empty explicit image version", async () => {
    const response = await GET(
      new Request("https://www.lamilialomi.com/api/category-media/" + categoryId + "?v="),
      { params: Promise.resolve({ categoryId }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("serves the current R2 image bytes for Next Image", async () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const fetchImage = vi.fn().mockResolvedValue(new Response(bytes, {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=14400" },
    }));
    vi.stubGlobal("fetch", fetchImage);
    mockCurrentImage(currentImageId);

    const response = await getImage(currentImageId);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const [sourceUrl, fetchOptions] = fetchImage.mock.calls[0] ?? [];
    expect(String(sourceUrl)).toBe(
      "https://media.example.com/categories/" + categoryId + "/image/" + currentImageId + "-books.webp",
    );
    expect(fetchOptions?.cache).toBe("no-store");
    expect(fetchOptions?.redirect).toBe("error");
    expect(fetchOptions?.signal?.aborted).toBe(false);
  });

  it("keeps legacy category media URLs as redirects", async () => {
    mockCurrentImage(currentImageId);

    const response = await getLegacyImage();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://media.example.com/categories/" + categoryId + "/image/" + currentImageId + "-books.webp",
    );
  });

  it("serves current Supabase category media bytes without exposing the signed URL", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const signedUrl = "https://project.storage.supabase.co/object/sign/public-media/image?token=short";
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl }, error: null });
    const categoryRow = {
      image_asset_id: currentImageId,
      image_storage_path: storagePath,
      image_storage_provider: "supabase",
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: categoryRow, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const fetchImage = vi.fn().mockResolvedValue(new Response(bytes, {
      headers: { "Content-Type": "image/png" },
    }));
    vi.stubGlobal("fetch", fetchImage);
    mocks.createServiceRoleClient.mockReturnValue({
      from: vi.fn(() => ({ select })),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await getImage(currentImageId);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("location")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const [sourceUrl, fetchOptions] = fetchImage.mock.calls[0] ?? [];
    expect(String(sourceUrl)).toBe(signedUrl);
    expect(fetchOptions?.cache).toBe("no-store");
    expect(fetchOptions?.redirect).toBe("error");
    expect(fetchOptions?.signal?.aborted).toBe(false);
  });

  it("returns not found after the category image is removed", async () => {
    mockCurrentImage(null);

    const response = await getImage(currentImageId);

    expect(response.status).toBe(404);
  });
});
