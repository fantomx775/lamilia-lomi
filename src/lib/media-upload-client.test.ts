import { describe, expect, it } from "vitest";

import { getMediaErrorMessage, getMediaUploadErrorMessage } from "./media-upload-client";

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
});
