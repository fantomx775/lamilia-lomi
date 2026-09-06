import { createBrowserClient } from "@supabase/ssr";

export function getClientPublicEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "",
  };
}

export function createClient() {
  const env = getClientPublicEnv();

  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw new Error("Supabase public environment is not configured.");
  }

  return createBrowserClient(env.supabaseUrl, env.supabasePublishableKey);
}
