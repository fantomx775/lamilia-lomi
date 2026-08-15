export type PublicEnvName =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  | "NEXT_PUBLIC_APP_URL";

type EnvLike = Record<string, string | undefined>;

export type BackendMode = "supabase" | "local";

export class AppConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "AppConfigurationError";
  }
}

export function getPublicEnv(
  env: EnvLike = process.env,
) {
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey:
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "",
    appUrl: env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };
}

export function getMissingPublicEnv(
  env: EnvLike = process.env,
) {
  const values = getPublicEnv(env);

  return [
    values.supabaseUrl ? null : "NEXT_PUBLIC_SUPABASE_URL",
    values.supabasePublishableKey ? null : "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    values.appUrl ? null : "NEXT_PUBLIC_APP_URL",
  ].filter((name): name is PublicEnvName => Boolean(name));
}

export function isSupabaseConfigured() {
  const env = getPublicEnv();

  return Boolean(env.supabaseUrl && env.supabasePublishableKey);
}

export function getBackendMode(env: EnvLike = process.env): BackendMode {
  const configuredMode = env.LAMILIA_BACKEND?.trim().toLowerCase();

  if (configuredMode === "local") {
    if (env.NODE_ENV === "production") {
      throw new AppConfigurationError(
        "LAMILIA_BACKEND=local is not allowed in production.",
      );
    }

    return "local";
  }

  if (configuredMode === "supabase") {
    return "supabase";
  }

  if (env.NODE_ENV === "test" || env.VITEST) {
    return "local";
  }

  if (env.NEXT_PHASE === "phase-production-build") {
    return "local";
  }

  throw new AppConfigurationError(
    "LAMILIA_BACKEND must be explicitly set to supabase or local.",
  );
}

export function getRequiredSupabaseEnv(env: EnvLike = process.env) {
  const publicEnv = getPublicEnv(env);
  const missing = [
    publicEnv.supabaseUrl ? null : "NEXT_PUBLIC_SUPABASE_URL",
    publicEnv.supabasePublishableKey
      ? null
      : "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].filter((name): name is string => Boolean(name));

  if (missing.length) {
    throw new AppConfigurationError(
      `Supabase configuration is missing: ${missing.join(", ")}.`,
    );
  }

  return {
    url: publicEnv.supabaseUrl,
    publishableKey: publicEnv.supabasePublishableKey,
  };
}

export function getServiceRoleKey(env: EnvLike = process.env) {
  const value = env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!value) {
    throw new AppConfigurationError(
      "SUPABASE_SERVICE_ROLE_KEY is required for the server-only admin user read path.",
    );
  }

  return value;
}
