import { describe, expect, it } from "vitest";

import {
  CommunityAuthorizationError,
  CommunityConflictError,
  CommunityRateLimitError,
  CommunityValidationError,
  mapCommunityDatabaseError,
} from "./errors";

describe("community database error mapping", () => {
  it.each([
    ["23505", CommunityConflictError],
    ["40001", CommunityConflictError],
    ["42501", CommunityAuthorizationError],
    ["22023", CommunityValidationError],
    ["23514", CommunityValidationError],
    ["23502", CommunityValidationError],
    ["42900", CommunityRateLimitError],
  ])("maps database code %s to a safe domain error", (code, ErrorType) => {
    const error = mapCommunityDatabaseError(code);
    expect(error).toBeInstanceOf(ErrorType);
    expect(error.message).not.toContain(code);
    expect(error.message).not.toContain("duplicate key value");
  });

  it("hides unexpected database error details behind a generic operation error", () => {
    expect(mapCommunityDatabaseError("secret-driver-detail").message).toBe("Community operation failed.");
  });
});
