import { NextResponse } from "next/server";

import { getBackendMode } from "@/lib/config";
import {
  clearAuthResumeIntent,
  getAuthResumeRedirect,
  redeemAuthResumeIntent,
  readAuthResumeIntent,
} from "@/lib/auth-resume";
import { normalizeLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const locale = normalizeLocale(requestUrl.searchParams.get("locale") ?? undefined);
  const intent = await readAuthResumeIntent();

  if (getBackendMode() !== "supabase") {
    return failureResponse(requestUrl, locale);
  }

  const supabase = await createClient();
  const callbackCode = requestUrl.searchParams.get("code");

  if (callbackCode) {
    const { error } = await supabase.auth.exchangeCodeForSession(callbackCode);

    if (error) {
      // A user who already completed the flow may revisit a one-time callback
      // URL. Do not trap that confirmed session in a verification error page.
      const { data } = await supabase.auth.getUser();

      if (!data.user?.email_confirmed_at) {
        return failureResponse(requestUrl, locale);
      }
    }
  }

  const { data } = await supabase.auth.getUser();

  if (!data.user?.email_confirmed_at) {
    return failureResponse(requestUrl, locale);
  }

  await redeemAuthResumeIntent(intent ?? {});
  await clearAuthResumeIntent();
  return successResponse(requestUrl, getAuthResumeRedirect(intent, locale));
}

function successResponse(requestUrl: URL, path: string) {
  const response = NextResponse.redirect(new URL(path, requestUrl.origin));
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}

function failureResponse(requestUrl: URL, locale: string) {
  const response = NextResponse.redirect(
    new URL(`/${locale}/login?error=verification_failed`, requestUrl.origin),
  );
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}
