import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getCanonicalAppUrl, getRequiredSupabaseEnv } from "@/lib/config";

const storageKey = "lamilia-password-recovery";
const verifierKey = `${storageKey}-code-verifier`;
const recoveryTtl = 900;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getCanonicalAppUrl().protocol === "https:",
    path: "/",
  };
}

// Keep the recovery verifier and session separate from ordinary sign-in.
export async function createRecoveryClient(readOnly = false) {
  const env = getRequiredSupabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(env.url, env.publishableKey, {
    cookieOptions: {
      name: storageKey,
      ...cookieOptions(),
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (entries) => {
        if (readOnly) return;
        for (const { name, value, options } of entries) {
          // Preserve deletion cookies; otherwise cap the browser session.
          cookieStore.set(name, value, {
            ...options,
            maxAge: Math.min(options.maxAge ?? recoveryTtl, recoveryTtl),
          });
        }
      },
    },
  });
}

export async function preserveRecoveryVerifier() {
  const cookieStore = await cookies();
  const verifier = cookieStore.get(verifierKey);
  // The SDK replaces this short cookie before sending and removes it on a
  // failed request. Restore the previous one so an already sent link still works.
  return () => {
    if (verifier) cookieStore.set(verifier.name, verifier.value, {
      ...cookieOptions(), maxAge: recoveryTtl,
    });
  };
}

export async function clearRecoveryCookies() {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (name === storageKey || name.startsWith(`${storageKey}.`)) {
      cookieStore.delete(name);
    }
  }
}
