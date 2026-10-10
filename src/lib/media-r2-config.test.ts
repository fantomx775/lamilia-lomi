import { describe, expect, it } from "vitest";

import { AppConfigurationError } from "./config";
import {
  getMediaUploadProvider,
  getR2StorageConfig,
  r2PublicMediaUrl,
} from "./media-r2-config";

const validR2Env = {
  R2_ACCOUNT_ID: "1234567890abcdef1234567890abcdef",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_PRIVATE_BUCKET: "lamilia-media-private",
  R2_PUBLIC_BUCKET: "lamilia-media-public",
  R2_PUBLIC_BASE_URL: "https://media.example.com",
};

describe("R2 media configuration", () => {
  it("keeps Supabase as the default and fails closed when R2 is explicitly enabled without credentials", () => {
    expect(getMediaUploadProvider({})).toBe("supabase");
    expect(() => getMediaUploadProvider({ MEDIA_STORAGE_PROVIDER: "r2" })).toThrow(
      "R2 media configuration is missing",
    );
    expect(() => getR2StorageConfig({ MEDIA_STORAGE_PROVIDER: "r2" })).toThrow(AppConfigurationError);
  });

  it("requires separate private and public buckets and an HTTPS CDN origin", () => {
    expect(getMediaUploadProvider({ ...validR2Env, MEDIA_STORAGE_PROVIDER: "r2" })).toBe("r2");
    expect(() => getR2StorageConfig({
      ...validR2Env,
      R2_PRIVATE_BUCKET: "same-bucket",
      R2_PUBLIC_BUCKET: "same-bucket",
    })).toThrow("must name different buckets");
    expect(() => getR2StorageConfig({ ...validR2Env, R2_PUBLIC_BASE_URL: "http://media.example.com" })).toThrow(
      "must be an HTTPS origin",
    );
  });

  it("builds an encoded public image URL only for a product-owned object key", () => {
    expect(r2PublicMediaUrl(
      "https://media.example.com",
      "products/11111111-1111-4111-8111-111111111111/gallery/asset-1-cover photo.webp",
    )).toBe("https://media.example.com/products/11111111-1111-4111-8111-111111111111/gallery/asset-1-cover%20photo.webp");
    expect(r2PublicMediaUrl("https://media.example.com", "products/../secret.jpg")).toBeNull();
    expect(r2PublicMediaUrl("https://media.example.com", "other/path/image.jpg")).toBeNull();
  });
});
