import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  tusOptions: undefined as { onProgress?: (sent: number, total: number) => void; onSuccess?: () => void } | undefined,
}));

vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(_file: File, options: typeof mocks.tusOptions) {
      mocks.tusOptions = options;
    }

    findPreviousUploads() {
      return Promise.resolve([]);
    }

    start() {
      mocks.events.push("supabase:start");
      mocks.tusOptions?.onProgress?.(10, 10);
      mocks.tusOptions?.onSuccess?.();
    }
  },
}));

vi.mock("./supabase/client", () => ({
  createClient: () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "session" } }, error: null }) } }),
  getClientPublicEnv: () => ({ supabasePublishableKey: "publishable" }),
}));

import { getMediaErrorMessage, getMediaUploadErrorMessage, uploadMedia } from "./media-upload-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("media upload error handling", () => {
  it("hides raw TUS and Storage details from users", () => {
    const error = new Error(
      "tus: unexpected response while creating upload, response code: 400, response text: Invalid key: products/example/gallery/Zdjęcie cyfrowe 1.webp",
    );

    expect(getMediaUploadErrorMessage(error)).toBe("Nie udało się przesłać pliku. Spróbuj ponownie.");
    expect(getMediaUploadErrorMessage(error)).not.toContain("tus:");
    expect(getMediaUploadErrorMessage(error)).not.toContain("Invalid key");
  });

  it("maps expired upload authorization to a session message", () => {
    const error = Object.assign(new Error("request failed"), {
      originalResponse: { getStatus: () => 401 },
    });

    expect(getMediaUploadErrorMessage(error)).toBe("Sesja administratora wygasła. Zaloguj się ponownie.");
  });

  it("keeps a separate fallback for failed cleanup", () => {
    expect(getMediaErrorMessage(new Error("storage failure"), "Nie udało się usunąć pliku. Spróbuj ponownie.")).toBe(
      "Nie udało się usunąć pliku. Spróbuj ponownie.",
    );
  });

  it("uploads R2 first and then the retained Supabase mirror", async () => {
    mocks.events = [];
    const progress: number[] = [];
    class TestXMLHttpRequest {
      status = 0;
      upload: { onprogress?: (event: ProgressEvent) => void } = {};
      onload?: () => void;
      onerror?: () => void;
      onabort?: () => void;
      headers: Record<string, string> = {};

      open(method: string) {
        expect(method).toBe("PUT");
      }

      setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
      }

      send(file: File) {
        expect(file.name).toBe("cover.jpg");
        expect(this.headers["Content-Type"]).toBe("image/jpeg");
        mocks.events.push("r2:start");
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
        this.status = 200;
        this.onload?.();
        mocks.events.push("r2:complete");
      }
    }
    vi.stubGlobal("XMLHttpRequest", TestXMLHttpRequest);

    await uploadMedia(
      new File(["image"], "cover.jpg", { type: "image/jpeg" }),
      {
        driver: "r2-mirrored",
        r2: { url: "https://r2.example/signed-put", headers: { "Content-Type": "image/jpeg" } },
        supabase: {
          driver: "supabase-tus",
          endpoint: "https://project.storage.supabase.co/upload/resumable",
          token: "signed-token",
          bucket: "public-media",
          path: "products/product-id/cover/asset-cover.jpg",
        },
      },
      "image/jpeg",
      (value) => progress.push(value),
    );

    expect(mocks.events).toEqual(["r2:start", "r2:complete", "supabase:start"]);
    expect(progress).toEqual([25, 100]);
  });
});
