import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getRequiredSupabaseEnv } from "@/lib/config";

export async function createClient() {
  const env = getRequiredSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(env.url, env.publishableKey, {
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

export async function getCurrentAccessToken() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();

  return data.session?.access_token ?? null;
}
