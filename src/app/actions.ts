"use server";

import { redirect } from "next/navigation";

import { getBackendMode } from "@/lib/config";
import {
  buildAuthRedirect,
  createDemoSession,
  isUnlockRegistrationContext,
  validateRegistrationInput,
} from "@/lib/auth";
import {
  buildSupabaseAuthCallbackUrl,
  createAuthResumeIntent,
  redeemAuthResumeIntent,
  setAuthResumeIntent,
} from "@/lib/auth-resume";
import { redeemPremiumCodeForRequest } from "@/lib/premium-request";
import { getDemoSession, setDemoSession, clearDemoSession } from "@/lib/session.server";
import { scheduleReviewReminder } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { getProductBySlugForRequest } from "@/lib/products-request";
import type { Locale } from "@/i18n/routing";

export async function loginDemoAction(formData: FormData) {
  const email = String(formData.get("email") ?? "demo@lamilialomi.test");
  const locale = String(formData.get("locale") ?? "en");
  const redirectTo = String(formData.get("redirectTo") ?? `/${locale}/library`);
  const code = String(formData.get("code") ?? "");

  if (getBackendMode() === "supabase") {
    const intent = createAuthResumeIntent({
      locale,
      returnTo: redirectTo,
      code,
    });
    const safeRedirectTo = intent.returnTo;
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: String(formData.get("password") ?? ""),
    });

    if (error) {
      await setAuthResumeIntent({ locale, returnTo: redirectTo, code });
      redirect(`/${locale}/login?error=invalid_credentials&redirectTo=${encodeURIComponent(safeRedirectTo)}`);
    }

    await setAuthResumeIntent({ locale, returnTo: redirectTo, code });
    await redeemAuthResumeIntent(intent);
    redirect(buildAuthRedirect({ locale, redirectTo: safeRedirectTo }));
  }

  const session = createDemoSession({
    email,
    emailVerified: !email.includes("unverified"),
    preferredLocale: locale,
  });

  await setDemoSession(session);
  redirect(buildAuthRedirect({ locale, redirectTo, code }));
}

export async function registerDemoAction(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en") as Locale;
  const redirectTo = String(formData.get("redirectTo") ?? `/${locale}/library`);
  const code = String(formData.get("code") ?? "");

  if (!isUnlockRegistrationContext({ locale, redirectTo, code })) {
    redirect(`/${locale}/products`);
  }

  const result = validateRegistrationInput({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    termsAccepted: formData.get("termsAccepted") === "on",
    marketingConsent: formData.get("marketingConsent") === "on",
    preferredLocale: locale,
  });

  if (!result.ok) {
    if (getBackendMode() === "supabase") {
      const safeRedirectTo = createAuthResumeIntent({
        locale,
        returnTo: redirectTo,
        code,
      }).returnTo;
      await setAuthResumeIntent({ locale, returnTo: redirectTo, code });
      redirect(`/${locale}/register?error=consent&redirectTo=${encodeURIComponent(safeRedirectTo)}`);
    }

    const params = new URLSearchParams({ error: "consent", redirectTo });

    if (code) {
      params.set("code", code);
    }

    redirect(`/${locale}/register?${params.toString()}`);
  }

  if (getBackendMode() === "supabase") {
    await setAuthResumeIntent({ locale, returnTo: redirectTo, code });
    const safeRedirectTo = createAuthResumeIntent({
      locale,
      returnTo: redirectTo,
      code,
    }).returnTo;
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
      redirect(`/${locale}/register?error=auth&redirectTo=${encodeURIComponent(safeRedirectTo)}`);
    }

    redirect(buildAuthRedirect({ locale, redirectTo: safeRedirectTo }));
  }

  await setDemoSession(
    createDemoSession({
      email: result.value.email,
      emailVerified: false,
      marketingConsent: result.value.marketingConsent,
      preferredLocale: locale,
    }),
  );
  redirect(buildAuthRedirect({ locale, redirectTo, code }));
}

export async function verifyDemoEmailAction(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  const redirectTo = String(formData.get("redirectTo") ?? `/${locale}/account`);

  if (getBackendMode() === "supabase") {
    const safeRedirectTo = createAuthResumeIntent({ locale, returnTo: redirectTo }).returnTo;
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();

    if (!data.user) {
      redirect(`/${locale}/login?redirectTo=${encodeURIComponent(safeRedirectTo)}`);
    }

    redirect(data.user.email_confirmed_at ? safeRedirectTo : `${safeRedirectTo}${safeRedirectTo.includes("?") ? "&" : "?"}verify=required`);
  }

  const session = await getDemoSession();

  if (!session) {
    redirect(`/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  await setDemoSession({ ...session, emailVerified: true });
  redirect(redirectTo);
}

export async function logoutAction(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");

  await clearDemoSession();
  redirect(`/${locale}`);
}

export async function unlockPremiumAction(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  const productSlug = String(formData.get("productSlug") ?? "");
  const code = String(formData.get("code") ?? "");
  const redirectTo = `/${locale}/products/${productSlug}`;
  const product = await getProductBySlugForRequest(productSlug);

  if (!product) {
    redirect(`${redirectTo}?unlock=product_not_found`);
  }

  const session = await getDemoSession();

  if (!session && getBackendMode() === "local") {
    redirect(
      `/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}&code=${encodeURIComponent(code)}`,
    );
  }

  if (session && !session.emailVerified && getBackendMode() === "local") {
    redirect(`${redirectTo}?code=${encodeURIComponent(code)}&verify=required`);
  }

  const result = await redeemPremiumCodeForRequest({
    productSlug,
    productId: product.id,
    code,
  });

  if (!result.ok) {
    if (result.status === "auth_required") {
      if (getBackendMode() === "supabase") {
        await setAuthResumeIntent({ locale, productSlug, returnTo: redirectTo, code });
        const safeRedirectTo = createAuthResumeIntent({
          locale,
          productSlug,
          returnTo: redirectTo,
          code,
        }).returnTo;
        redirect(`/${locale}/login?redirectTo=${encodeURIComponent(safeRedirectTo)}`);
      }

      redirect(
        `/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}`,
      );
    }

    if (result.status === "email_unverified") {
      if (getBackendMode() === "supabase") {
        await setAuthResumeIntent({ locale, productSlug, returnTo: redirectTo, code });
        const safeRedirectTo = createAuthResumeIntent({
          locale,
          productSlug,
          returnTo: redirectTo,
          code,
        }).returnTo;
        redirect(`${safeRedirectTo}?verify=required`);
      }

      redirect(`${redirectTo}?verify=required`);
    }

    redirect(`${redirectTo}?code=${encodeURIComponent(code)}&unlock=${result.status}`);
  }

  if (result.status === "success") {
    scheduleReviewReminder({ unlockedAt: new Date(), delayDays: product.reviewDelayDays });
  }
  redirect(`${redirectTo}?unlocked=1`);
}
