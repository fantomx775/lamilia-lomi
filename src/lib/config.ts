export type PublicEnvName =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  | "NEXT_PUBLIC_APP_URL";

type EnvLike = Record<string, string | undefined>;

export function getPublicEnv(
  env: EnvLike = process.env,
) {
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey:
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
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
