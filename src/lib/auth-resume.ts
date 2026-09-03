import "server-only";

import { cookies } from "next/headers";

import { normalizeLocale } from "./locale";
import { getPublicEnv } from "./config";
import { redeemPremiumCodeForRequest } from "./premium-request";
import { getProductBySlugForRequest } from "./products-request";
import { productSlugFromReturnTo, sanitizeReturnTo } from "./return-to";
import type { Locale } from "@/i18n/routing";

export const authResumeCookieName = "ll_auth_resume";
export const authResumeMaxAgeSeconds = 15 * 60;

const productSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AuthResumeIntent = {
  locale: Locale;
  productSlug?: string;
  returnTo: string;
  code?: string;
  createdAt: number;
};

export function buildSupabaseAuthCallbackUrl(locale: string) {
  const url = new URL("/auth/callback", getPublicEnv().appUrl);
  url.searchParams.set("locale", normalizeLocale(locale));

  return url.toString();
}

export function createAuthResumeIntent(input: {
  locale?: string;
  productSlug?: string;
  returnTo?: string | null;
  code?: string | null;
  now?: number;
}): AuthResumeIntent {
  const locale = normalizeLocale(input.locale);
  const requestedProductSlug = normalizeProductSlug(input.productSlug);
  const fallback = requestedProductSlug
    ? `/${locale}/products/${requestedProductSlug}`
    : `/${locale}/account`;
  const returnTo = sanitizeInternalReturnTo(input.returnTo, locale, fallback);
  const productSlug =
    productSlugFromReturnTo(returnTo, locale) ??
    (input.returnTo == null ? requestedProductSlug : undefined);

  return {
    locale,
    productSlug,
    returnTo,
    code: normalizeCode(input.code),
    createdAt: input.now ?? Date.now(),
  };
}

export function sanitizeInternalReturnTo(
  value: string | null | undefined,
  locale: Locale,
  fallback = `/${locale}/account`,
) {
  return sanitizeReturnTo(value, locale, fallback);
}

export function getAuthResumeRedirect(
  intent: Pick<AuthResumeIntent, "locale" | "returnTo"> | null | undefined,
  callbackLocale?: string,
) {
  const locale = normalizeLocale(intent?.locale ?? callbackLocale);
  const fallback = `/${locale}/account`;

  return sanitizeInternalReturnTo(intent?.returnTo, locale, fallback);
}

export async function setAuthResumeIntent(input: {
  locale?: string;
  productSlug?: string;
  returnTo?: string | null;
  code?: string | null;
}) {
  const intent = createAuthResumeIntent(input);
  const cookieStore = await cookies();

  cookieStore.set(authResumeCookieName, encodeIntent(intent), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: authResumeMaxAgeSeconds,
    path: "/",
  });
}

export async function readAuthResumeIntent() {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(authResumeCookieName)?.value;

  return decodeIntent(encoded);
}

export async function clearAuthResumeIntent() {
  const cookieStore = await cookies();
  cookieStore.delete(authResumeCookieName);
}

export async function redeemAuthResumeIntent(intent: Pick<AuthResumeIntent, "productSlug" | "code">) {
  if (!intent.productSlug || !intent.code) {
    return null;
  }

  const product = await getProductBySlugForRequest(intent.productSlug);
  if (!product) {
    return null;
  }

  return redeemPremiumCodeForRequest({
    productSlug: intent.productSlug,
    productId: product.id,
    code: intent.code,
  });
}

function encodeIntent(intent: AuthResumeIntent) {
  return Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
}

function decodeIntent(value: string | undefined): AuthResumeIntent | null {
  if (!value || value.length > 5500) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AuthResumeIntent>;
    const locale = normalizeLocale(parsed.locale);
    const returnTo = typeof parsed.returnTo === "string" ? parsed.returnTo : undefined;
    const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;

    if (!returnTo || !createdAt || Date.now() - createdAt > authResumeMaxAgeSeconds * 1000 || Date.now() - createdAt < 0) {
      return null;
    }

    const intent = createAuthResumeIntent({
      locale,
      productSlug: typeof parsed.productSlug === "string" ? parsed.productSlug : undefined,
      returnTo,
      code: typeof parsed.code === "string" ? parsed.code : undefined,
      now: createdAt,
    });

    return intent;
  } catch {
    return null;
  }
}

function normalizeProductSlug(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();

  return normalized && productSlugPattern.test(normalized) ? normalized : undefined;
}

function normalizeCode(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized.slice(0, 256) : undefined;
}
