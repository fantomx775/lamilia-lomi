import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/config";

export function createClient() {
  const env = getPublicEnv();

  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw new Error("Supabase public environment is not configured.");
  }

  return createBrowserClient(env.supabaseUrl, env.supabasePublishableKey);
}
