import { NextResponse } from "next/server";

import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import {
  authResumeIntentMatchesUser,
  clearAuthResumeIntent,
  getAuthResumeRedirect,
  redeemAuthResumeIntent,
  readAuthResumeIntent,
  sanitizeInternalReturnTo,
} from "@/lib/auth-resume";
import { normalizeLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";
import { clearUnlockIntent } from "@/lib/unlock-intent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const locale = normalizeLocale(requestUrl.searchParams.get("locale") ?? undefined);
  const callbackReturnTo = sanitizeInternalReturnTo(
    requestUrl.searchParams.get("returnTo"),
    locale,
  );
  const intent = await readAuthResumeIntent();

  if (getBackendMode() !== "supabase") {
    return failureResponse(locale);
  }

  const supabase = await createClient();
  const callbackCode = requestUrl.searchParams.get("code");

  if (!callbackCode) {
    if (intent) {
      return failureResponse(locale, intent, callbackReturnTo);
    }

    const user = await getCallbackUser(supabase);
    if (user?.email_confirmed_at) {
      return successResponse(callbackReturnTo);
    }

    return failureResponse(locale, undefined, callbackReturnTo);
  }

  let exchangeError;
  try {
    ({ error: exchangeError } = await supabase.auth.exchangeCodeForSession(callbackCode));
  } catch (error) {
    console.error("[auth-callback] Code exchange failed unexpectedly.", {
      type: error instanceof Error ? error.name : typeof error,
    });
    return failureResponse(locale, intent, callbackReturnTo);
  }

  if (exchangeError) {
    // A reused callback may still return a confirmed user, but it cannot
    // redeem a pending intent because this request did not establish a session.
    if (intent) {
      return failureResponse(locale, intent, callbackReturnTo);
    }

    const user = await getCallbackUser(supabase);
    if (user?.email_confirmed_at) {
      return successResponse(callbackReturnTo);
    }

    return failureResponse(locale, undefined, callbackReturnTo);
  }

  const user = await getCallbackUser(supabase);

  if (!user?.email_confirmed_at) {
    return failureResponse(locale, intent, callbackReturnTo);
  }

  if (intent && !authResumeIntentMatchesUser(intent, user)) {
    await clearAuthResumeIntent();
    return failureResponse(locale, intent, callbackReturnTo, "verification_mismatch");
  }

  let redemption;

  try {
    redemption = await redeemAuthResumeIntent(intent ?? {});
  } catch (error) {
    console.error("[auth-callback] Auth resume redemption failed unexpectedly.", {
      type: error instanceof Error ? error.name : typeof error,
    });
    return failureResponse(locale, intent, callbackReturnTo);
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

  return successResponse(intent ? getAuthResumeRedirect(intent, locale) : callbackReturnTo);
}

async function getCallbackUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { data, error } = await supabase.auth.getUser();
    return error ? null : data.user;
  } catch (error) {
    console.error("[auth-callback] Current user lookup failed unexpectedly.", {
      type: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
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

function failureResponse(
  locale: string,
  intent?: Parameters<typeof getAuthResumeRedirect>[0],
  callbackReturnTo?: string,
  error = "verification_failed",
) {
  const target = new URL(`/${locale}/login`, getCanonicalAppUrl());
  target.searchParams.set("error", error);

  const returnTo = intent
    ? getAuthResumeRedirect(intent, locale)
    : sanitizeInternalReturnTo(callbackReturnTo, normalizeLocale(locale));

  if (returnTo !== `/${locale}/account`) {
    target.searchParams.set("returnTo", returnTo);
  }

  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}
