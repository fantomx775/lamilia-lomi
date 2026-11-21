import { describe, expect, it } from "vitest";
import { ownedMediaSourceIndex } from "../../../tests/e2e/helpers/owned-media-diagnostics";

describe("owned media source matching", () => {
  const sources = [
    { origin: "https://127.0.0.1:3443", path: "/api/media/controlled" },
    { origin: "https://127.0.0.1:3443", path: "/storage/v1/object/sign/public-videos/controlled.mp4" },
  ];

  it("matches only the configured origin and path", () => {
    expect(ownedMediaSourceIndex("https://127.0.0.1:3443/api/media/controlled?token=secret", sources)).toBe(0);
    expect(ownedMediaSourceIndex("https://127.0.0.1:3443/storage/v1/object/sign/public-videos/controlled.mp4?token=secret", sources)).toBe(1);
  });

  it("rejects a foreign origin that serves the same path", () => {
    expect(ownedMediaSourceIndex("https://attacker.example/api/media/controlled", sources)).toBe(-1);
    expect(ownedMediaSourceIndex("https://localhost:3443/api/media/controlled", sources)).toBe(-1);
  });

  it("rejects malformed URLs", () => {
    expect(ownedMediaSourceIndex("not a URL", sources)).toBe(-1);
  });
});
