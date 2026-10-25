import "server-only";

export type CommunityFlagName =
  | "COLORING_CLUB_PUBLIC_ENABLED"
  | "COLORING_CLUB_UPLOADS_ENABLED";

type EnvLike = Record<string, string | undefined>;

/** Feature switches are server-only and fail closed unless the value is exactly `true`. */
export function isCommunityFeatureEnabled(
  flag: CommunityFlagName,
  env: EnvLike = process.env,
): boolean {
  return env[flag] === "true";
}

export function getCommunityFlags(env: EnvLike = process.env) {
  return {
    publicEnabled: isCommunityFeatureEnabled("COLORING_CLUB_PUBLIC_ENABLED", env),
    uploadsEnabled: isCommunityFeatureEnabled("COLORING_CLUB_UPLOADS_ENABLED", env),
  };
}
