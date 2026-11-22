import { describe, expect, it } from "vitest";
import { rewriteIsolatedTusLocation } from "./issue-127-tus-location.mjs";

const request = "/storage/v1/upload/resumable";
const suffix = "/storage/v1/upload/resumable/controlled%2Fopaque?signature=synthetic-only";

describe("owned local TLS gateway Storage upload Location", () => {
  it.each(["http://127.0.0.1:55421", "http://localhost:55421", "https://localhost:3443"])("preserves opaque path/query from permitted origin %s", (origin) => {
    expect(rewriteIsolatedTusLocation(request, origin + suffix)).toBe("https://localhost:3443" + suffix);
  });
  it("accepts a relative owned Storage location", () => {
    expect(rewriteIsolatedTusLocation(request + "/existing", suffix)).toBe("https://localhost:3443" + suffix);
  });
  it.each([
    "https://remote.example/storage/v1/upload/resumable/id",
    "http://localhost:55422/storage/v1/upload/resumable/id",
    "https://localhost:443/storage/v1/upload/resumable/id",
    "https://user:password@localhost:3443/storage/v1/upload/resumable/id",
    "https://localhost:3443/storage/v1/upload/resumable/id#fragment",
    "http://localhost:55421/storage/v1/object/sign/private",
    "http://localhost:55421/storage/v1/upload/resumable-other/id",
    "http://localhost:55421/storage/v1/upload/resumable/../object",
  ])("refuses unknown origin, credentials, fragment or unrelated path", (location) => {
    expect(() => rewriteIsolatedTusLocation(request, location)).toThrow("Refusing an unexpected isolated Storage upload location.");
  });
  it("refuses rewriting a non-TUS application request", () => {
    expect(() => rewriteIsolatedTusLocation("/api/admin/assets", suffix)).toThrow();
  });
});
