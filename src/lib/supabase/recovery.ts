import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getCanonicalAppUrl, getRequiredSupabaseEnv } from "@/lib/config";

const storageKey = "lamilia-password-recovery";

// Keep the recovery verifier and session separate from ordinary sign-in.
export async function createRecoveryClient() {
  const env = getRequiredSupabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(env.url, env.publishableKey, {
    cookieOptions: {
      name: storageKey,
      httpOnly: true,
      sameSite: "lax",
      secure: getCanonicalAppUrl().protocol === "https:",
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (entries) => {
        for (const { name, value, options } of entries) {
          // Preserve deletion cookies; otherwise cap the browser session.
          cookieStore.set(name, value, {
            ...options,
            maxAge: Math.min(options.maxAge ?? 900, 900),
          });
        }
      },
    },
  });
}

export async function clearRecoveryCookies() {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (name === storageKey || name.startsWith(`${storageKey}.`)) {
      cookieStore.delete(name);
    }
  }
}
