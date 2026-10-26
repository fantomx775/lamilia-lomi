import { describe, expect, it } from "vitest";

import { decodeCommunityPopularCursor, decodeCommunityTimestampCursor, encodeCommunityPopularCursor, encodeCommunityTimestampCursor } from "./cursor";

describe("community timestamp cursor", () => {
  it("normalizes PostgREST UTC offsets textually and preserves microseconds", () => {
    const first = encodeCommunityTimestampCursor("2026-10-26T12:00:00.123456+00:00", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const nextMicrosecond = encodeCommunityTimestampCursor("2026-10-26T12:00:00.123457+00:00", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(decodeCommunityTimestampCursor(first)).toEqual({ timestamp: "2026-10-26T12:00:00.123456Z", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    expect(decodeCommunityTimestampCursor(nextMicrosecond)?.timestamp).toBe("2026-10-26T12:00:00.123457Z");
    expect(first).not.toBe(nextMicrosecond);
  });

  it("rejects malformed timestamps and IDs", () => {
    expect(decodeCommunityTimestampCursor(Buffer.from("2026-10-26T12:00:00.123456+01:00|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").toString("base64url"))).toBeNull();
  });
});


describe("cursor calendar validation", () => {
  it.each(["2026-02-30T10:00:00.123456Z", "2026-13-01T10:00:00Z", "2026-01-01T25:00:00Z"])("rejects an invalid calendar value: %s", (timestamp) => {
    const cursor = Buffer.from(`${timestamp}|11111111-1111-4111-8111-111111111111`).toString("base64url");
    expect(decodeCommunityTimestampCursor(cursor)).toBeNull();
  });
});

describe("community popular cursor", () => {
  it("preserves score and Postgres microseconds in a strict sort-specific cursor", () => {
    const cursor = encodeCommunityPopularCursor(23, "2026-10-26T12:00:00.123456+00:00", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(decodeCommunityPopularCursor(cursor)).toEqual({
      likesCount: 23,
      timestamp: "2026-10-26T12:00:00.123456Z",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(decodeCommunityPopularCursor(encodeCommunityTimestampCursor("2026-10-26T12:00:00Z", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"))).toBeNull();
  });

  it("rejects malformed or out-of-range popularity scores", () => {
    for (const likesCount of [-1, 2_147_483_648]) expect(() => encodeCommunityPopularCursor(likesCount, "2026-10-26T12:00:00Z", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toThrow();
    expect(decodeCommunityPopularCursor(Buffer.from("p|9999999999|2026-10-26T12:00:00Z|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").toString("base64url"))).toBeNull();
  });
});
