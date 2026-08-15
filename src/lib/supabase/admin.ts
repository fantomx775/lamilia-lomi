import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  getBackendMode,
  getRequiredSupabaseEnv,
  getServiceRoleKey,
} from "@/lib/config";

export function createServiceRoleClient() {
  if (getBackendMode() !== "supabase") {
    throw new Error("The Supabase service-role client is unavailable in local mode.");
  }

  const env = getRequiredSupabaseEnv();
  const serviceRoleKey = getServiceRoleKey();

  return createSupabaseClient(env.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
