"use server";

import { redirect } from "next/navigation";

import { buildAuthRedirect, createDemoSession, validateRegistrationInput } from "@/lib/auth";
import { validatePremiumCode } from "@/lib/premium";
import { getDemoSession, setDemoSession, clearDemoSession } from "@/lib/session.server";
import { scheduleReviewReminder } from "@/lib/reminders";
import type { Locale } from "@/i18n/routing";

export async function loginDemoAction(formData: FormData) {
  const email = String(formData.get("email") ?? "demo@lamilialomi.test");
  const locale = String(formData.get("locale") ?? "en");
  const redirectTo = String(formData.get("redirectTo") ?? `/${locale}/library`);
  const code = String(formData.get("code") ?? "");
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
  const result = validateRegistrationInput({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    termsAccepted: formData.get("termsAccepted") === "on",
    marketingConsent: formData.get("marketingConsent") === "on",
    preferredLocale: locale,
  });

  if (!result.ok) {
    redirect(`/${locale}/register?error=consent&redirectTo=${encodeURIComponent(redirectTo)}`);
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
  const session = await getDemoSession();

  if (!session) {
    redirect(
      `/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}&code=${encodeURIComponent(code)}`,
    );
  }

  if (!session.emailVerified) {
    redirect(`${redirectTo}?code=${encodeURIComponent(code)}&verify=required`);
  }

  const result = validatePremiumCode({
    productSlug,
    code,
    session,
  });

  if (!result.ok) {
    redirect(`${redirectTo}?code=${encodeURIComponent(code)}&unlock=${result.reason}`);
  }

  await setDemoSession({
    ...session,
    unlockedProductIds: Array.from(
      new Set([...session.unlockedProductIds, result.productId]),
    ),
  });

  scheduleReviewReminder({ unlockedAt: new Date(), delayDays: 14 });
  redirect(`${redirectTo}?unlocked=1`);
}
