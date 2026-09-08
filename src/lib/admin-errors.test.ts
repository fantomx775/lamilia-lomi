import { describe, expect, it } from "vitest";

import {
  ADMIN_ERROR_CODES,
  classifyAdminDatabaseError,
  formatAdminErrors,
  getAdminErrorMessage,
} from "./admin-errors";

describe("admin error contract", () => {
  it("maps stable Supabase codes and constraints to application errors", () => {
    expect(classifyAdminDatabaseError({
      code: "23505",
      constraint: "premium_codes_normalized_code_key",
    })).toBe(ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_DUPLICATE);
    expect(classifyAdminDatabaseError({
      code: "23505",
      constraint: "premium_codes_code_key",
    })).toBe(ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_DUPLICATE);
    expect(classifyAdminDatabaseError({ code: "23503" })).toBe(ADMIN_ERROR_CODES.CONFLICT_DATA);
    expect(classifyAdminDatabaseError({ code: "42501" })).toBe(ADMIN_ERROR_CODES.AUTHORIZATION_DENIED);
    expect(classifyAdminDatabaseError({ code: "22P02" })).toBe(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT);
  });

  it("never renders an unrecognized query value as raw UI feedback", () => {
    expect(formatAdminErrors("Supabase raw database failure", "pl")).toBe(
      getAdminErrorMessage(ADMIN_ERROR_CODES.INTERNAL, "pl"),
    );
    expect(formatAdminErrors([
      ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REQUIRED,
      ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_DUPLICATE,
    ], "de")).toContain("Premium-Code");
  });
});
