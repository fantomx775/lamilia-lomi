"use server";

import { redirect } from "next/navigation";

import { getBackendMode } from "@/lib/config";
import {
  buildAuthRedirect,
  createDemoSession,
  isUnlockRegistrationContext,
  isSupabaseEmailNotConfirmedError,
  validateRegistrationInput,
} from "@/lib/auth";
import {
  buildSupabaseAuthCallbackUrl,
  createAuthResumeIntent,
  clearAuthResumeIntent,
  redeemAuthResumeIntent,
  setAuthResumeIntent,
} from "@/lib/auth-resume";
import { isSupportedLocale, normalizeLocale } from "@/lib/locale";
import { redeemPremiumCodeForRequest } from "@/lib/premium-request";
import { getDemoSession, setDemoSession, clearDemoSession } from "@/lib/session.server";
import { scheduleReviewReminder } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { getProductBySlugForRequest } from "@/lib/products-request";
import {
  clearUnlockIntent,
  getUnlockIntent,
  setUnlockIntent,
} from "@/lib/unlock-intent";
import {
  productSlugFromReturnTo,
  sanitizeReturnTo,
  switchLocalePath,
} from "@/lib/return-to";

export async function startUnlockAuthAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const productSlug = text(formData, "productSlug");
  const product = await getProductBySlugForRequest(productSlug);

  if (!product) {
    redirect(`/${locale}/products?unlock=product_not_found`);
  }

  const returnTo = `/${locale}/products/${product.slug}`;
  const mode = text(formData, "mode") === "register" ? "register" : "login";

  await setUnlockIntent({
    locale,
    productSlug: product.slug,
    returnTo,
    code: text(formData, "code"),
  });

  redirect(`/${locale}/${mode}?returnTo=${encodeURIComponent(returnTo)}`);
}

export async function switchLocaleAction(formData: FormData) {
  const sourceLocaleInput = text(formData, "sourceLocale");
  const targetLocaleInput = text(formData, "targetLocale");

  if (!isSupportedLocale(sourceLocaleInput) || !isSupportedLocale(targetLocaleInput)) {
    redirect("/en/library");
  }

  const sourceLocale = sourceLocaleInput;
  const targetLocale = targetLocaleInput;
  let currentUrl: URL;

  try {
    currentUrl = new URL(
      `${text(formData, "pathname")}${withSearchPrefix(text(formData, "search"))}`,
      "http://lamilialomi.local",
    );
  } catch {
    redirect(`/${targetLocale}/library`);
  }

  const safeCurrent = sanitizeReturnTo(
    `${currentUrl.pathname}${currentUrl.search}`,
    sourceLocale,
    `/${sourceLocale}/library`,
  );
  const safeCurrentUrl = new URL(safeCurrent, "http://lamilialomi.local");
  const productSlug = productSlugFromReturnTo(safeCurrent, sourceLocale);
  const nestedReturnTo =
    currentUrl.searchParams.get("returnTo") ?? currentUrl.searchParams.get("redirectTo");
  const safeNestedReturnTo = nestedReturnTo
    ? sanitizeReturnTo(nestedReturnTo, sourceLocale, `/${sourceLocale}/library`)
    : undefined;
  const nestedProductSlug = safeNestedReturnTo
    ? productSlugFromReturnTo(safeNestedReturnTo, sourceLocale)
    : undefined;
  const contextProductSlug = productSlug ?? nestedProductSlug;
  const translatedPath = switchLocalePath(
    safeCurrentUrl.pathname,
    sourceLocale,
    targetLocale,
  );
  const translatedNestedReturnTo = safeNestedReturnTo
    ? switchLocalePath(safeNestedReturnTo, sourceLocale, targetLocale)
    : undefined;
  const targetSearchParams = new URLSearchParams();

  for (const key of ["returnTo", "redirectTo", "error", "unlock", "step", "unlocked"]) {
    const value = currentUrl.searchParams.get(key);

    if (!value) {
      continue;
    }

    if ((key === "returnTo" || key === "redirectTo") && translatedNestedReturnTo) {
      targetSearchParams.set(key, translatedNestedReturnTo);
    } else if (key !== "returnTo" && key !== "redirectTo") {
      targetSearchParams.set(key, value.slice(0, 128));
    }
  }

  const targetPath = `${translatedPath}${targetSearchParams.toString() ? `?${targetSearchParams}` : ""}`;

  if (contextProductSlug) {
    const product = await getProductBySlugForRequest(contextProductSlug);

    if (!product) {
      await clearUnlockIntent();
      redirect(`/${targetLocale}/products`);
    }

    const existingIntent = await getUnlockIntent();
    const code = productSlug
      ? currentUrl.searchParams.get("code") ??
        currentUrl.searchParams.get("premiumCode") ??
        undefined
      : undefined;

    await setUnlockIntent({
      locale: targetLocale,
      productSlug: product.slug,
      returnTo: productSlug ? targetPath : translatedNestedReturnTo,
      code:
        code ||
        (existingIntent?.productSlug === product.slug ? existingIntent.code : undefined),
    });
  }

  redirect(targetPath);
}

export async function loginDemoAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
  );
  const existingIntent = await getUnlockIntent();
  const returnProductSlug = productSlugFromReturnTo(returnTo, locale);
  const currentIntent =
    existingIntent?.locale === locale && existingIntent.productSlug === returnProductSlug
      ? existingIntent
      : null;

  if (existingIntent && !currentIntent) {
    await clearUnlockIntent();
  }

  const code = text(formData, "code") || currentIntent?.code || "";

  if (getBackendMode() === "supabase") {
    const intent = createAuthResumeIntent({
      locale,
      productSlug: returnProductSlug,
      returnTo,
      code,
    });
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: text(formData, "email"),
      password: text(formData, "password"),
    });

    if (error) {
      await setAuthResumeIntent({ locale, returnTo, code });
      const errorCode = isSupabaseEmailNotConfirmedError(error)
        ? "email_unverified"
        : "invalid_credentials";
      redirect(`/${locale}/login?error=${errorCode}&returnTo=${encodeURIComponent(intent.returnTo)}`);
    }

    await setAuthResumeIntent({
      locale,
      productSlug: intent.productSlug,
      returnTo,
      code,
    });

    const redemption = await redeemAuthResumeIntent(intent);
    await clearAuthResumeIntent();

    if (redemption?.ok) {
      await clearUnlockIntent();
      if (redemption.status === "success") {
        const product = intent.productSlug
          ? await getProductBySlugForRequest(intent.productSlug)
          : null;
        scheduleReviewReminder({
          unlockedAt: new Date(),
          delayDays: product?.reviewDelayDays,
        });
      }
      redirect(
        appendQueryPath(
          intent.returnTo,
          "unlocked",
          redemption.status === "already_unlocked" ? "already" : "1",
        ),
      );
    }

    if (redemption && !redemption.ok) {
      if (redemption.status === "email_unverified") {
        redirect(appendQueryPath(intent.returnTo, "step", "verify"));
      }

      await setUnlockIntent({
        locale,
        productSlug: intent.productSlug ?? "",
        returnTo: intent.returnTo,
        code,
      });
      redirect(appendQueryPath(intent.returnTo, "unlock", redemption.status));
    }

    redirect(buildAuthRedirect({ locale, redirectTo: intent.returnTo }));
  }

  await preserveUnlockIntent({ locale, returnTo, code });
  await setDemoSession(
    createDemoSession({
      email: text(formData, "email") || "demo@lamilialomi.test",
      emailVerified: !text(formData, "email").toLowerCase().includes("unverified"),
      preferredLocale: locale,
    }),
  );

  redirect(buildAuthRedirect({ locale, redirectTo: returnTo }));
}

export async function resendSupabaseVerificationEmailAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
  );
  const code = text(formData, "code");

  if (getBackendMode() !== "supabase") {
    redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  await setAuthResumeIntent({
    locale,
    productSlug: productSlugFromReturnTo(returnTo, locale),
    returnTo,
    code,
  });

  const supabase = await createClient();
  await supabase.auth.resend({
    type: "signup",
    email: text(formData, "email"),
    options: { emailRedirectTo: buildSupabaseAuthCallbackUrl(locale) },
  });

  redirect(
    `/${locale}/login?error=verification_sent&returnTo=${encodeURIComponent(returnTo)}`,
  );
}

export async function registerDemoAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
  );
  const code = text(formData, "code");

  if (!isUnlockRegistrationContext({ locale, redirectTo: returnTo })) {
    redirect(`/${locale}/products`);
  }

  await preserveUnlockIntent({ locale, returnTo, code });

  const result = validateRegistrationInput({
    email: text(formData, "email"),
    password: text(formData, "password"),
    termsAccepted: formData.get("termsAccepted") === "on",
    marketingConsent: formData.get("marketingConsent") === "on",
    preferredLocale: locale,
  });

  if (!result.ok) {
    redirect(`/${locale}/register?error=invalid&returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (getBackendMode() === "supabase") {
    const safeRedirectTo = createAuthResumeIntent({
      locale,
      returnTo,
      code,
    }).returnTo;
    await setAuthResumeIntent({ locale, returnTo, code });
    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email: result.value.email,
      password: result.value.password,
      options: {
        data: {
          marketing_consent: result.value.marketingConsent,
          preferred_locale: result.value.preferredLocale,
          terms_accepted: true,
        },
        emailRedirectTo: buildSupabaseAuthCallbackUrl(locale),
      },
    });

    if (error) {
      redirect(`/${locale}/register?error=auth&returnTo=${encodeURIComponent(safeRedirectTo)}`);
    }

    redirect(appendQueryPath(safeRedirectTo, "step", "verify"));
  }

  await setDemoSession(
    createDemoSession({
      email: result.value.email,
      emailVerified: false,
      marketingConsent: result.value.marketingConsent,
      preferredLocale: locale,
    }),
  );
  redirect(buildAuthRedirect({ locale, redirectTo: returnTo }));
}

export async function verifyDemoEmailAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
    `/${locale}/account`,
  );

  if (getBackendMode() === "supabase") {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();

    if (!data.user) {
      redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
    }

    redirect(
      data.user.email_confirmed_at
        ? returnTo
        : appendQueryPath(returnTo, "step", "verify"),
    );
  }

  const session = await getDemoSession();

  if (!session) {
    redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  await setDemoSession({ ...session, emailVerified: true });
  redirect(buildAuthRedirect({ locale, redirectTo: returnTo }));
}

export async function logoutAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));

  await clearDemoSession();
  await clearUnlockIntent();
  await clearAuthResumeIntent();
  redirect(`/${locale}`);
}

export async function unlockPremiumAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const productSlug = text(formData, "productSlug");
  const product = await getProductBySlugForRequest(productSlug);
  const returnTo = `/${locale}/products/${productSlug}`;
  const existingIntent = await getUnlockIntent();
  const code =
    text(formData, "code") ||
    (existingIntent?.locale === locale && existingIntent.productSlug === productSlug
      ? existingIntent.code
      : undefined) ||
    "";

  if (!product) {
    redirect(`/${locale}/products?unlock=product_not_found`);
  }

  const session = await getDemoSession();

  if (!session) {
    await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
    redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (!session.emailVerified) {
    await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
    redirect(appendQueryPath(returnTo, "step", "verify"));
  }

  const result = await redeemPremiumCodeForRequest({
    productSlug,
    productId: product.id,
    code,
  });

  if (!result.ok) {
    if (result.status === "auth_required") {
      await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
      redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
    }

    if (result.status === "email_unverified") {
      await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
      redirect(appendQueryPath(returnTo, "step", "verify"));
    }

    await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
    redirect(appendQueryPath(returnTo, "unlock", result.status));
  }

  await clearUnlockIntent();
  if (result.status === "success") {
    scheduleReviewReminder({ unlockedAt: new Date(), delayDays: product.reviewDelayDays });
  }
  redirect(
    appendQueryPath(
      returnTo,
      "unlocked",
      result.status === "already_unlocked" ? "already" : "1",
    ),
  );
}

async function preserveUnlockIntent(input: {
  locale: string;
  returnTo: string;
  code?: string;
}) {
  const productSlug = productSlugFromReturnTo(input.returnTo, input.locale);

  if (!productSlug) {
    await clearUnlockIntent();
    return;
  }

  const product = await getProductBySlugForRequest(productSlug);

  if (!product) {
    await clearUnlockIntent();
    return;
  }

  const existing = await getUnlockIntent();

  await setUnlockIntent({
    locale: input.locale,
    productSlug: product.slug,
    returnTo: input.returnTo,
    code:
      input.code ||
      (existing?.productSlug === product.slug ? existing.code : undefined),
  });
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function withSearchPrefix(value: string) {
  if (!value) {
    return "";
  }

  return value.startsWith("?") ? value : `?${value}`;
}

function appendQueryPath(path: string, key: string, value: string) {
  const url = new URL(path, "http://lamilialomi.local");
  url.searchParams.set(key, value);

  return `${url.pathname}${url.search}`;
}
