import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/config";

export async function createClient() {
  const env = getPublicEnv();
  const cookieStore = await cookies();

  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw new Error("Supabase public environment is not configured.");
  }

  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot set cookies. Proxy refreshes sessions.
        }
      },
    },
  });
}
