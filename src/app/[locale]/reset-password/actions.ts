"use server";

import { redirect } from "next/navigation";

import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import { normalizeLocale } from "@/lib/locale";
import { clearRecoveryCookies, createRecoveryClient } from "@/lib/supabase/recovery";

export async function requestPasswordReset(rawLocale: string, form: FormData) {
  const locale = normalizeLocale(rawLocale);
  const path = `/${locale}/reset-password`;
  const value = form.get("email");
  const email = typeof value === "string" ? value.trim() : "";
  if (getBackendMode() !== "supabase") redirect(`${path}?status=unavailable`);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect(`${path}?status=invalid-email`);
  }

  const callback = new URL("/auth/callback", getCanonicalAppUrl());
  callback.searchParams.set("locale", locale);
  callback.searchParams.set("recovery", "1");
  try {
    await clearRecoveryCookies();
    const supabase = await createRecoveryClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: callback.toString(),
    });
    if (error) console.warn("[password-recovery] Request rejected", { status: error.status });
  } catch {
    console.error("[password-recovery] Request failed");
  }

  // An address lookup or account-specific rate limit must not reveal an account.
  redirect(`${path}?status=requested`);
}

export async function saveRecoveredPassword(rawLocale: string, form: FormData) {
  const locale = normalizeLocale(rawLocale);
  const path = `/${locale}/reset-password`;
  if (getBackendMode() !== "supabase") redirect(`${path}?status=unavailable`);

  const supabase = await createRecoveryClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(`${path}?status=invalid-link`);

  const password = form.get("password");
  if (typeof password !== "string" || password.length < 8 || password.length > 128 ||
    password !== form.get("confirmation")) {
    redirect(`${path}?status=invalid-password`);
  }

  const result = await supabase.auth.updateUser({ password });
  if (result.error) redirect(`${path}?status=update-failed`);

  try {
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    await clearRecoveryCookies();
  }
  redirect(`${path}?status=complete`);
}
