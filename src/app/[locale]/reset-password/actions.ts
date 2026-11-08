"use server";

import { redirect } from "next/navigation";

import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import { normalizeLocale } from "@/lib/locale";
import { clearRecoveryCookies, createRecoveryClient, preserveRecoveryVerifier } from "@/lib/supabase/recovery";
import { createClient } from "@/lib/supabase/server";

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
  const restoreVerifier = await preserveRecoveryVerifier();
  try {
    await clearRecoveryCookies();
    const supabase = await createRecoveryClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: callback.toString(),
    });
    if (error) {
      restoreVerifier();
      console.warn("[password-recovery] Request rejected", { status: error.status });
    }
  } catch {
    restoreVerifier();
    console.error("[password-recovery] Request failed");
  }

  // An address lookup or account-specific rate limit must not reveal an account.
  redirect(`${path}?status=requested`);
}

export async function saveRecoveredPassword(rawLocale: string, userId: string, form: FormData) {
  const locale = normalizeLocale(rawLocale);
  const path = `/${locale}/reset-password`;
  if (getBackendMode() !== "supabase") redirect(`${path}?status=unavailable`);

  const supabase = await createRecoveryClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== userId) redirect(`${path}?status=invalid-link`);

  const password = form.get("password");
  if (typeof password !== "string" || password.length < 8 || password.length > 128 ||
    password !== form.get("confirmation")) {
    redirect(`${path}?status=invalid-password`);
  }

  const result = await supabase.auth.updateUser({ password });
  if (result.error) redirect(`${path}?status=update-failed`);

  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    console.warn("[password-recovery] Session sign-out failed");
  } finally {
    await clearRecoveryCookies();
  }

  // Sign in through the normal session cookie namespace only after the
  // recovery session has completed the password change.
  const email = data.user.email;
  let signedIn = false;
  if (email) {
    try {
      const client = await createClient();
      const { data: login, error: loginError } = await client.auth.signInWithPassword({ email, password });
      signedIn = !loginError && Boolean(login.session) && login.user?.id === userId;
      if (!signedIn && login.session) {
        await client.auth.signOut({ scope: "local" });
      }
    } catch {
      console.warn("[password-recovery] Automatic sign-in failed");
    }
  }
  redirect(signedIn ? `/${locale}/account` : `${path}?status=complete`);
}
