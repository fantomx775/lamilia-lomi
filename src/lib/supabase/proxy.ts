import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getBackendMode, getRequiredSupabaseEnv } from "@/lib/config";

export async function updateSession(
  request: NextRequest,
  response: NextResponse = NextResponse.next({ request }),
) {
  if (getBackendMode() === "local") {
    return response;
  }

  const env = getRequiredSupabaseEnv();

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  await supabase.auth.getClaims();

  return response;
}
