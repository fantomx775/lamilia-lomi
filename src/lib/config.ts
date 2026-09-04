export type PublicEnvName =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  | "NEXT_PUBLIC_APP_URL";

type EnvLike = Record<string, string | undefined>;

export type BackendMode = "supabase" | "local";

const localAppUrl = "http://127.0.0.1:3000";

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
    appUrl: getCanonicalAppUrl(env).origin,
  };
}

export function getCanonicalAppUrl(env: EnvLike = process.env) {
  const configuredAppUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  const rawAppUrl = configuredAppUrl || (allowsLocalDefaults(env) ? localAppUrl : "");

  if (!rawAppUrl) {
    throw new AppConfigurationError(
      "NEXT_PUBLIC_APP_URL is required in Supabase and production mode.",
    );
  }

  let parsed: URL;

  try {
    parsed = new URL(rawAppUrl);
  } catch {
    throw new AppConfigurationError(
      "NEXT_PUBLIC_APP_URL must be an absolute URL.",
    );
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new AppConfigurationError(
      "NEXT_PUBLIC_APP_URL must be an absolute origin without credentials, path, query, or hash.",
    );
  }

  if (requiresHttps(env) && parsed.protocol !== "https:") {
    throw new AppConfigurationError(
      "NEXT_PUBLIC_APP_URL must use HTTPS in Supabase and production mode.",
    );
  }

  if (
    parsed.protocol === "http:" &&
    (!allowsLocalDefaults(env) || !isLocalHostname(parsed.hostname))
  ) {
    throw new AppConfigurationError(
      "HTTP NEXT_PUBLIC_APP_URL is only allowed for an explicit local or test configuration.",
    );
  }

  return new URL(parsed.origin);
}

export function getMissingPublicEnv(
  env: EnvLike = process.env,
) {
  const values = {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey:
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "",
  };
  let appUrlIsValid = true;

  try {
    getCanonicalAppUrl(env);
  } catch {
    appUrlIsValid = false;
  }

  return [
    values.supabaseUrl ? null : "NEXT_PUBLIC_SUPABASE_URL",
    values.supabasePublishableKey ? null : "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    appUrlIsValid ? null : "NEXT_PUBLIC_APP_URL",
  ].filter((name): name is PublicEnvName => Boolean(name));
}

export function isSupabaseConfigured() {
  const env = process.env;

  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
      (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

export function getBackendMode(env: EnvLike = process.env): BackendMode {
  const configuredMode = env.LAMILIA_BACKEND?.trim().toLowerCase();

  if (configuredMode === "local") {
    if (env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build") {
      throw new AppConfigurationError(
        "LAMILIA_BACKEND=local is not allowed in production.",
      );
    }

    return "local";
  }

  if (configuredMode === "supabase") {
    return "supabase";
  }

  throw new AppConfigurationError(
    "LAMILIA_BACKEND must be explicitly set to supabase or local.",
  );
}

export function getRequiredSupabaseEnv(env: EnvLike = process.env) {
  const missing = [
    env.NEXT_PUBLIC_SUPABASE_URL ? null : "NEXT_PUBLIC_SUPABASE_URL",
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? null
      : "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].filter((name): name is string => Boolean(name));

  if (missing.length) {
    throw new AppConfigurationError(
      `Supabase configuration is missing: ${missing.join(", ")}.`,
    );
  }

  const appUrl = getCanonicalAppUrl(env);

  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL!,
    publishableKey:
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    appUrl: appUrl.origin,
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

function requiresHttps(env: EnvLike) {
  return (
    env.LAMILIA_BACKEND?.trim().toLowerCase() === "supabase" ||
    (env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build")
  );
}

function allowsLocalDefaults(env: EnvLike) {
  const configuredMode = env.LAMILIA_BACKEND?.trim().toLowerCase();

  if (configuredMode === "supabase") {
    return false;
  }

  return (
    configuredMode === "local" ||
    env.NODE_ENV === "test" ||
    Boolean(env.VITEST) ||
    (!configuredMode && env.NODE_ENV !== "production")
  );
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
