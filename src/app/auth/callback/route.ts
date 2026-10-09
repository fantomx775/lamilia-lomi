import { NextResponse } from "next/server";

import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import {
  authResumeCallbackIntentMatchesUser,
  authResumeIntentMatchesUser,
  clearAuthResumeIntent,
  decodeAuthResumeCallbackToken,
  getAuthResumeRedirect,
  redeemAuthResumeIntent,
  readAuthResumeIntent,
  sanitizeInternalReturnTo,
  setAuthResumeIntent,
} from "@/lib/auth-resume";
import { normalizeLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";
import { clearUnlockIntent, setUnlockIntent } from "@/lib/unlock-intent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const locale = normalizeLocale(requestUrl.searchParams.get("locale") ?? undefined);
  const safeCallbackReturnTo = sanitizeInternalReturnTo(
    requestUrl.searchParams.get("returnTo"),
    locale,
  );
  const callbackReturnTo = getAuthResumeRedirect(
    { locale, returnTo: safeCallbackReturnTo },
    locale,
  );
  const cookieIntent = await readAuthResumeIntent();
  const callbackIntent = decodeAuthResumeCallbackToken(requestUrl.searchParams.get("resume"));
  const intent = callbackIntent ?? cookieIntent;

  if (getBackendMode() !== "supabase") {
    return failureResponse(locale);
  }

  const supabase = await createClient();
  const callbackCode = requestUrl.searchParams.get("code");
  const callbackTokenHash = requestUrl.searchParams.get("token_hash");
  const callbackType = requestUrl.searchParams.get("type");

  if (
    (callbackCode && callbackTokenHash) ||
    (callbackTokenHash && callbackType !== "email")
  ) {
    await persistAuthResumeIntent(intent);
    return failureResponse(locale, intent, callbackReturnTo);
  }

  if (!callbackCode && !callbackTokenHash) {
    if (intent) {
      await persistAuthResumeIntent(intent);
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
    if (callbackTokenHash) {
      ({ error: exchangeError } = await supabase.auth.verifyOtp({
        token_hash: callbackTokenHash,
        type: "email",
      }));
    } else {
      ({ error: exchangeError } = await supabase.auth.exchangeCodeForSession(callbackCode!));
    }
  } catch (error) {
    console.error("[auth-callback] Code exchange failed unexpectedly.", {
      type: error instanceof Error ? error.name : typeof error,
    });
    await persistAuthResumeIntent(intent);
    return failureResponse(locale, intent, callbackReturnTo);
  }

  if (exchangeError) {
    // A reused callback may still return a confirmed user, but it cannot
    // redeem a pending intent because this request did not establish a session.
    if (intent) {
      await persistAuthResumeIntent(intent);
      return failureResponse(locale, intent, callbackReturnTo);
    }

    const user = await getCallbackUser(supabase);
    if (user?.email_confirmed_at) {
      return successResponse(callbackReturnTo);
    }

    return failureResponse(locale, undefined, callbackReturnTo);
  }

  const user = await getCallbackUser(supabase);

  if (intent && user && !authResumeCallbackIntentMatchesUser(intent, user)) {
    await clearAuthResumeIntent();
    await clearUnlockIntent();
    return failureResponse(locale, intent, callbackReturnTo, "verification_mismatch");
  }

  // Email confirmation callbacks can carry an email-bound intent created
  // before Supabase returns the new user's ID. Bind it as soon as the
  // callback establishes that identity so a later retry cannot be claimed by
  // another account that reuses the email address.
  const verifiedIntent =
    intent && user?.id && !intent.userId
      ? { ...intent, userId: user.id }
      : intent;

  if (!user?.email_confirmed_at) {
    if (verifiedIntent && (verifiedIntent.userId || verifiedIntent.emailHash)) {
      await clearUnlockIntent();
      if (verifiedIntent.userId) {
        await setAuthResumeIntent({
          locale: verifiedIntent.locale,
          productSlug: verifiedIntent.productSlug,
          returnTo: verifiedIntent.returnTo,
          code: verifiedIntent.code,
          userId: verifiedIntent.userId,
          emailHash: verifiedIntent.emailHash,
        });
      } else {
        // An email hash alone cannot authorize a later account to resume a
        // premium code. Require the user to enter it again if identity lookup
        // did not provide an account ID for this callback.
        await clearAuthResumeIntent();
      }
      return failureResponse(
        locale,
        verifiedIntent.userId ? verifiedIntent : undefined,
        callbackReturnTo,
        "verification_unavailable",
      );
    }

    return failureResponse(locale, verifiedIntent, callbackReturnTo);
  }

  if (
    callbackIntent &&
    (!cookieIntent || !authResumeIntentMatchesUser(cookieIntent, user))
  ) {
    if (cookieIntent) {
      await clearAuthResumeIntent();
    }
  }

  // The signed auth resume carries the code's account binding. Remove any
  // older guest code before redemption so it cannot survive a failed attempt
  // and later be applied to a different account.
  await clearUnlockIntent();

  let redemption;

  try {
    redemption = await redeemAuthResumeIntent(verifiedIntent ?? {});
  } catch (error) {
    console.error("[auth-callback] Auth resume redemption failed unexpectedly.", {
      type: error instanceof Error ? error.name : typeof error,
    });
    await persistAuthResumeIntent(verifiedIntent);
    await persistUnlockIntent(verifiedIntent);
    if (verifiedIntent?.productSlug && verifiedIntent.code) {
      return successResponse(
        appendQuery(getAuthResumeRedirect(verifiedIntent, locale), "unlock", "unexpected"),
      );
    }

    return failureResponse(locale, verifiedIntent, callbackReturnTo);
  }
  if (redemption?.ok) {
    await clearAuthResumeIntent();
    await clearUnlockIntent();
    return successResponse(
      appendQuery(
        getAuthResumeRedirect(verifiedIntent, locale),
        "unlocked",
        redemption.status === "already_unlocked" ? "already" : "1",
      ),
    );
  }

  if (redemption && !redemption.ok) {
    await persistAuthResumeIntent(verifiedIntent);
    await persistUnlockIntent(verifiedIntent);
    return successResponse(
      appendQuery(getAuthResumeRedirect(verifiedIntent, locale), "unlock", redemption.status),
    );
  }

  await clearAuthResumeIntent();
  return successResponse(
    verifiedIntent
      ? getAuthResumeRedirect(verifiedIntent, locale)
      : callbackReturnTo,
  );
}

async function persistAuthResumeIntent(
  intent: {
    locale: string;
    productSlug?: string;
    returnTo: string;
    code?: string;
    userId?: string;
    emailHash?: string;
  } | null,
) {
  if (!intent?.userId) {
    return;
  }

  await setAuthResumeIntent({
    locale: intent.locale,
    productSlug: intent.productSlug,
    returnTo: intent.returnTo,
    code: intent.code,
    userId: intent.userId,
    emailHash: intent.emailHash,
  });
}

async function persistUnlockIntent(
  intent: {
    locale: string;
    productSlug?: string;
    returnTo: string;
    code?: string;
  } | null,
) {
  if (!intent?.productSlug || !intent.code) {
    return;
  }

  await setUnlockIntent({
    locale: intent.locale,
    productSlug: intent.productSlug,
    returnTo: intent.returnTo,
  });
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

  return `${url.pathname}${url.search}${url.hash}`;
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
