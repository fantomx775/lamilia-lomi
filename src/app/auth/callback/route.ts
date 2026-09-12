import { NextResponse } from "next/server";

import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import {
  clearAuthResumeIntent,
  getAuthResumeRedirect,
  redeemAuthResumeIntent,
  readAuthResumeIntent,
} from "@/lib/auth-resume";
import { normalizeLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";
import { clearUnlockIntent } from "@/lib/unlock-intent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const locale = normalizeLocale(requestUrl.searchParams.get("locale") ?? undefined);
  const intent = await readAuthResumeIntent();

  if (getBackendMode() !== "supabase") {
    return failureResponse(locale);
  }

  const supabase = await createClient();
  const callbackCode = requestUrl.searchParams.get("code");

  if (callbackCode) {
    let error;

    try {
      ({ error } = await supabase.auth.exchangeCodeForSession(callbackCode));
    } catch (exchangeError) {
      console.error("[auth-callback] Code exchange failed unexpectedly.", {
        type: exchangeError instanceof Error ? exchangeError.name : typeof exchangeError,
      });
      return failureResponse(locale, intent);
    }

    if (error) {
      // A user who already completed the flow may revisit a one-time callback
      // URL. Do not trap that confirmed session in a verification error page.
      const { data } = await supabase.auth.getUser();

      if (!data.user?.email_confirmed_at) {
        return failureResponse(locale, intent);
      }
    }
  }

  const { data } = await supabase.auth.getUser();

  if (!data.user?.email_confirmed_at) {
    return failureResponse(locale, intent);
  }

  let redemption;

  try {
    redemption = await redeemAuthResumeIntent(intent ?? {});
  } catch (error) {
    console.error("[auth-callback] Auth resume redemption failed unexpectedly.", {
      type: error instanceof Error ? error.name : typeof error,
    });
    return failureResponse(locale, intent);
  }
  await clearAuthResumeIntent();

  if (redemption?.ok) {
    await clearUnlockIntent();
    return successResponse(
      appendQuery(
        getAuthResumeRedirect(intent, locale),
        "unlocked",
        redemption.status === "already_unlocked" ? "already" : "1",
      ),
    );
  }

  if (redemption && !redemption.ok) {
    return successResponse(
      appendQuery(getAuthResumeRedirect(intent, locale), "unlock", redemption.status),
    );
  }

  return successResponse(getAuthResumeRedirect(intent, locale));
}

function appendQuery(path: string, key: string, value: string) {
  const url = new URL(path, "http://lamilialomi.local");
  url.searchParams.set(key, value);

  return `${url.pathname}${url.search}`;
}

function successResponse(path: string) {
  const response = NextResponse.redirect(new URL(path, getCanonicalAppUrl()));
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}

function failureResponse(locale: string, intent?: Parameters<typeof getAuthResumeRedirect>[0]) {
  const target = new URL(`/${locale}/login`, getCanonicalAppUrl());
  target.searchParams.set("error", "verification_failed");

  const returnTo = getAuthResumeRedirect(intent, locale);

  if (returnTo !== `/${locale}/account`) {
    target.searchParams.set("returnTo", returnTo);
  }

  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}
