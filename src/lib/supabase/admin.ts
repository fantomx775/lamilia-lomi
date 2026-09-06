import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  getBackendMode,
  getRequiredSupabaseEnv,
  getServiceRoleKey,
} from "@/lib/config";

export function createServiceRoleClient(options?: {
  storageAuthorizationToken?: string;
}) {
  if (getBackendMode() !== "supabase") {
    throw new Error("The Supabase service-role client is unavailable in local mode.");
  }

  const env = getRequiredSupabaseEnv();
  const serviceRoleKey = getServiceRoleKey();
  const usesLegacyJwt = serviceRoleKey.startsWith("eyJ");

  return createSupabaseClient(env.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(!usesLegacyJwt
      ? {
          global: {
            headers: {
              apikey: serviceRoleKey,
              ...(options?.storageAuthorizationToken
                ? { Authorization: `Bearer ${options.storageAuthorizationToken}` }
                : {}),
            },
            fetch: (input: RequestInfo | URL, init?: RequestInit) => {
              const headers = new Headers(init?.headers);
              headers.set("apikey", serviceRoleKey);
              if (options?.storageAuthorizationToken) {
                headers.set("authorization", `Bearer ${options.storageAuthorizationToken}`);
              } else {
                headers.delete("authorization");
              }
              return fetch(input, { ...init, headers });
            },
          },
        }
      : {}),
  });
}
