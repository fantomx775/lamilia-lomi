import { cookies } from "next/headers";
import { cache } from "react";

import { getBackendMode } from "./config";
import { parseDemoSession, serializeDemoSession } from "./auth";
import { normalizeLocale } from "./locale";
import { hasSupabaseAuthCookie } from "./supabase/auth-cookie";
import { createClient } from "./supabase/server";
import type { DemoSession } from "./types";

export const demoSessionCookie = "ll_demo_session";

const getSupabaseUserContextForRequest = cache(async () => {
  if (getBackendMode() !== "supabase") {
    return null;
  }

  const cookieStore = await cookies();

  if (!hasSupabaseAuthCookie(cookieStore.getAll())) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  return {
    supabase,
    user: error ? null : data.user,
  };
});

const getSupabaseProfileForRequest = cache(async () => {
  const context = await getSupabaseUserContextForRequest();

  if (!context?.user) {
    return null;
  }

  const { data, error } = await context.supabase
    .from("profiles")
    .select("role, marketing_consent, terms_accepted_at, preferred_locale")
    .eq("id", context.user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load the current profile: ${error.message}`);
  }

  return data;
});

export const getDemoSession = cache(async () => {
  if (getBackendMode() === "supabase") {
    const context = await getSupabaseUserContextForRequest();

    if (!context?.user) {
      return null;
    }

    const [profile, unlockResult] = await Promise.all([
      getSupabaseProfileForRequest(),
      context.supabase
        .from("user_product_unlocks")
        .select("product_id")
        .eq("user_id", context.user.id),
    ]);

    if (unlockResult.error) {
      throw new Error(`Could not load the current unlocks: ${unlockResult.error.message}`);
    }

    return {
      email: context.user.email ?? "",
      role: profile?.role === "admin" ? "admin" : "user",
      emailVerified: Boolean(context.user.email_confirmed_at),
      marketingConsent: Boolean(profile?.marketing_consent),
      termsAcceptedAt: profile?.terms_accepted_at ?? context.user.created_at,
      preferredLocale: profile?.preferred_locale ?? "en",
      unlockedProductIds: (unlockResult.data ?? [])
        .map((unlock) => unlock.product_id)
        .filter((id): id is string => typeof id === "string"),
      isDemo: false,
    } satisfies DemoSession;
  }

  const cookieStore = await cookies();

  return parseDemoSession(cookieStore.get(demoSessionCookie)?.value);
});

export type AccountSession = Pick<
  DemoSession,
  "email" | "role" | "emailVerified" | "marketingConsent" | "isDemo"
>;

export const getAccountSessionForRequest = cache(
  async (): Promise<AccountSession | null> => {
    if (getBackendMode() === "local") {
      return getDemoSession();
    }

    const context = await getSupabaseUserContextForRequest();

    if (!context?.user) {
      return null;
    }

    const profile = await getSupabaseProfileForRequest();

    return {
      email: context.user.email ?? "",
      role: profile?.role === "admin" ? "admin" : "user",
      emailVerified: Boolean(context.user.email_confirmed_at),
      marketingConsent: Boolean(profile?.marketing_consent),
      isDemo: false,
    };
  },
);

export const getHeaderAccountStateForRequest = cache(async () => {
  if (getBackendMode() === "local") {
    const session = await getDemoSession();

    return session
      ? { isSignedIn: true, isAdmin: session.role === "admin" }
      : null;
  }

  const context = await getSupabaseUserContextForRequest();

  if (!context?.user) {
    return null;
  }

  try {
    const profile = await getSupabaseProfileForRequest();
    return { isSignedIn: true, isAdmin: profile?.role === "admin" };
  } catch {
    return { isSignedIn: true, isAdmin: false };
  }
});

export const getAdminLayoutAccessForRequest = cache(async () => {
  if (getBackendMode() === "local") {
    const session = await getDemoSession();

    return session?.role === "admin"
      ? { preferredLocale: session.preferredLocale }
      : null;
  }

  const context = await getSupabaseUserContextForRequest();

  if (!context?.user) {
    return null;
  }

  try {
    const profile = await getSupabaseProfileForRequest();

    return profile?.role === "admin"
      ? { preferredLocale: normalizeLocale(profile.preferred_locale) }
      : null;
  } catch {
    return null;
  }
});

export type ProductDetailAccess = {
  session: Pick<DemoSession, "emailVerified" | "isDemo"> | null;
  isUnlocked: boolean;
  localSession?: DemoSession;
};

export const getProductDetailAccessForRequest = cache(
  async (productId: string): Promise<ProductDetailAccess> => {
    if (getBackendMode() === "local") {
      const session = await getDemoSession();

      return {
        session,
        isUnlocked: session?.unlockedProductIds.includes(productId) ?? false,
        localSession: session ?? undefined,
      };
    }

    const context = await getSupabaseUserContextForRequest();

    if (!context?.user) {
      return { session: null, isUnlocked: false };
    }

    const session = {
      emailVerified: Boolean(context.user.email_confirmed_at),
      isDemo: false,
    };

    if (!session.emailVerified) {
      return { session, isUnlocked: false };
    }

    const { data, error } = await context.supabase
      .from("user_product_unlocks")
      .select("product_id")
      .eq("user_id", context.user.id)
      .eq("product_id", productId)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not check this product unlock: ${error.message}`);
    }

    return { session, isUnlocked: Boolean(data) };
  },
);

export async function getSupabaseAuthContext() {
  if (getBackendMode() !== "supabase") {
    return { supabase: null, user: null } as const;
  }

  const context = await getSupabaseUserContextForRequest();

  return {
    supabase: context?.supabase ?? null,
    user: context?.user ?? null,
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
