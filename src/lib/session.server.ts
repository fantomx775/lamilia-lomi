import { cookies } from "next/headers";

import { getBackendMode } from "./config";
import { parseDemoSession, serializeDemoSession } from "./auth";
import { createClient } from "./supabase/server";
import type { DemoSession } from "./types";

export const demoSessionCookie = "ll_demo_session";

export async function getDemoSession() {
  if (getBackendMode() === "supabase") {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null;
    }

    const [{ data: profile, error: profileError }, { data: unlocks, error: unlockError }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("role, marketing_consent, terms_accepted_at, preferred_locale")
          .eq("id", data.user.id)
          .maybeSingle(),
        supabase
          .from("user_product_unlocks")
          .select("product_id")
          .eq("user_id", data.user.id),
      ]);

    if (profileError) {
      throw new Error(`Could not load the current profile: ${profileError.message}`);
    }

    if (unlockError) {
      throw new Error(`Could not load the current unlocks: ${unlockError.message}`);
    }

    return {
      email: data.user.email ?? "",
      role: profile?.role === "admin" ? "admin" : "user",
      emailVerified: Boolean(data.user.email_confirmed_at),
      marketingConsent: Boolean(profile?.marketing_consent),
      termsAcceptedAt: profile?.terms_accepted_at ?? data.user.created_at,
      preferredLocale: profile?.preferred_locale ?? "en",
      unlockedProductIds: (unlocks ?? [])
        .map((unlock) => unlock.product_id)
        .filter((id): id is string => typeof id === "string"),
      isDemo: false,
    } satisfies DemoSession;
  }

  const cookieStore = await cookies();

  return parseDemoSession(cookieStore.get(demoSessionCookie)?.value);
}

export async function getSupabaseAuthContext() {
  if (getBackendMode() !== "supabase") {
    return { supabase: null, user: null } as const;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  return {
    supabase,
    user: error ? null : data.user,
  } as const;
}

export async function setDemoSession(session: DemoSession) {
  if (getBackendMode() === "supabase") {
    throw new Error("Demo session writes are unavailable in Supabase mode.");
  }

  const cookieStore = await cookies();

  cookieStore.set(demoSessionCookie, serializeDemoSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function clearDemoSession() {
  if (getBackendMode() === "supabase") {
    const supabase = await createClient();
    await supabase.auth.signOut();
    return;
  }

  const cookieStore = await cookies();

  cookieStore.delete(demoSessionCookie);
}
