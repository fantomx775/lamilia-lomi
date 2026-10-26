export class CommunityConflictError extends Error {
  constructor(message = "Community record changed or is no longer available.") {
    super(message);
    this.name = "CommunityConflictError";
  }
}

export class CommunityAuthorizationError extends Error {
  constructor(message = "Community authorization denied.") {
    super(message);
    this.name = "CommunityAuthorizationError";
  }
}

export class CommunityValidationError extends Error {
  constructor(message = "Community input is invalid.") {
    super(message);
    this.name = "CommunityValidationError";
  }
}

export class CommunityRateLimitError extends Error {
  constructor(message = "Community rate limit reached. Try again later.") {
    super(message);
    this.name = "CommunityRateLimitError";
  }
}

/** Convert database codes to stable, safe domain errors without exposing driver details. */
export function mapCommunityDatabaseError(code: string): Error {
  switch (code) {
    case "23505":
      return new CommunityConflictError("That community value is already in use.");
    case "40001":
      return new CommunityConflictError();
    case "42501":
      return new CommunityAuthorizationError();
    case "22023":
    case "23514":
    case "23502":
      return new CommunityValidationError();
    case "42900":
      return new CommunityRateLimitError();
    default:
      return new Error("Community operation failed.");
  }
}
