import { beforeEach, describe, expect, it, vi } from "vitest";

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

function mockCurrentImage(imageId: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: imageId
      ? {
          image_asset_id: imageId,
          image_storage_path: storagePath.replace(currentImageId, imageId),
          image_storage_provider: "r2_public",
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

describe("category media version route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com");
    mocks.getBackendMode.mockReturnValue("supabase");
  });

  it("rejects an old image version after category replacement", async () => {
    mockCurrentImage(currentImageId);

    const response = await getImage(oldImageId);

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns the current R2 image through its versioned route", async () => {
    mockCurrentImage(currentImageId);

    const response = await getImage(currentImageId);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://media.example.com/categories/" +
        categoryId +
        "/image/" +
        currentImageId +
        "-books.webp",
    );
    expect(response.headers.get("cache-control")).toBe("private, max-age=30");
  });

  it("returns not found after the category image is removed", async () => {
    mockCurrentImage(null);

    const response = await getImage(currentImageId);

    expect(response.status).toBe(404);
  });
});