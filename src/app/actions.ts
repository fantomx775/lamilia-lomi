"use server";

import { redirect } from "next/navigation";

import { getBackendMode } from "@/lib/config";
import {
  buildAuthRedirect,
  createDemoSession,
  isUnlockRegistrationContext,
  validateRegistrationInput,
} from "@/lib/auth";
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
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: String(formData.get("password") ?? ""),
    });

    if (error) {
      redirect(`/${locale}/login?error=invalid_credentials&redirectTo=${encodeURIComponent(redirectTo)}&code=${encodeURIComponent(code)}`);
    }

    redirect(buildAuthRedirect({ locale, redirectTo, code }));
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
    const params = new URLSearchParams({ error: "consent", redirectTo });

    if (code) {
      params.set("code", code);
    }

    redirect(`/${locale}/register?${params.toString()}`);
  }

  if (getBackendMode() === "supabase") {
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
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/${locale}/account`,
      },
    });

    if (error) {
      redirect(`/${locale}/register?error=auth&redirectTo=${encodeURIComponent(redirectTo)}&code=${encodeURIComponent(code)}`);
    }

    redirect(buildAuthRedirect({ locale, redirectTo, code }));
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
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();

    if (!data.user) {
      redirect(`/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}`);
    }

    redirect(data.user.email_confirmed_at ? redirectTo : `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}verify=required`);
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
      redirect(
        `/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}&code=${encodeURIComponent(code)}`,
      );
    }

    if (result.status === "email_unverified") {
      redirect(`${redirectTo}?code=${encodeURIComponent(code)}&verify=required`);
    }

    redirect(`${redirectTo}?code=${encodeURIComponent(code)}&unlock=${result.status}`);
  }

  if (result.status === "success") {
    scheduleReviewReminder({ unlockedAt: new Date(), delayDays: product.reviewDelayDays });
  }
  redirect(`${redirectTo}?unlocked=1`);
}
