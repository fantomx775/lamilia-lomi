import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { normalizeLocale } from "./locale";
import { getCanonicalAppUrl } from "./config";
import { redeemPremiumCodeForRequest } from "./premium-request";
import { getProductBySlugForRequest } from "./products-request";
import { normalizePremiumCodeForRequest } from "./premium-code";
import { productSlugFromReturnTo, sanitizeReturnTo } from "./return-to";
import type { Locale } from "@/i18n/routing";

export const authResumeCookieName = "ll_auth_resume";
export const authResumeMaxAgeSeconds = 60 * 60;

const productSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AuthResumeIntent = {
  locale: Locale;
  productSlug?: string;
  returnTo: string;
  code?: string;
  userId?: string;
  emailHash?: string;
  createdAt: number;
};

export function buildSupabaseAuthCallbackUrl(locale: string, returnTo?: string | null) {
  const url = new URL("/auth/callback", getCanonicalAppUrl());
  const normalizedLocale = normalizeLocale(locale);
  const safeReturnTo = sanitizeInternalReturnTo(returnTo, normalizedLocale);

  url.searchParams.set("locale", normalizedLocale);
  if (safeReturnTo !== `/${normalizedLocale}/account`) {
    url.searchParams.set("returnTo", safeReturnTo);
  }

  return url.toString();
}

export function createAuthResumeIntent(input: {
  locale?: string;
  productSlug?: string;
  returnTo?: string | null;
  code?: string | null;
  userId?: string | null;
  email?: string | null;
  emailHash?: string | null;
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
    code: normalizePremiumCodeForRequest(input.code) || undefined,
    userId: normalizeUserId(input.userId),
    emailHash: normalizeEmailHash(input.emailHash) ?? hashEmail(input.email),
    createdAt: input.now ?? Date.now(),
  };
}

export function authResumeIntentMatchesUser(
  intent: Pick<AuthResumeIntent, "userId" | "emailHash">,
  user: { id?: string | null; email?: string | null },
) {
  if (!intent.userId && !intent.emailHash) {
    return false;
  }

  if (intent.userId && intent.userId !== user.id) {
    return false;
  }

  if (intent.emailHash) {
    const currentEmailHash = hashEmail(user.email);
    if (!currentEmailHash || !safeEqual(intent.emailHash, currentEmailHash)) {
      return false;
    }
  }

  return true;
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
  userId?: string | null;
  email?: string | null;
  emailHash?: string | null;
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
  const payload = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
  return `${payload}.${signIntent(payload)}`;
}

function decodeIntent(value: string | undefined): AuthResumeIntent | null {
  if (!value || value.length > 5500) {
    return null;
  }

  try {
    const [payload, signature, extra] = value.split(".");

    if (!payload || !signature || extra !== undefined || !hasValidSignature(payload, signature)) {
      return null;
    }

    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AuthResumeIntent>;
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
      userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
      emailHash: typeof parsed.emailHash === "string" ? parsed.emailHash : undefined,
      now: createdAt,
    });

    return intent;
  } catch {
    return null;
  }
}

function signIntent(payload: string) {
  return createHmac("sha256", getIntentSigningSecret()).update(payload).digest("base64url");
}

function hasValidSignature(payload: string, signature: string) {
  const expected = Buffer.from(signIntent(payload));
  const actual = Buffer.from(signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function getIntentSigningSecret() {
  const configuredSecret =
    process.env.AUTH_RESUME_SECRET?.trim() ||
    process.env.DEMO_SESSION_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_RESUME_SECRET or a server-only signing secret is required in production.");
  }

  return "local-auth-resume-secret-change-before-production";
}

function hashEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();

  return normalized
    ? createHash("sha256").update(normalized).digest("hex")
    : undefined;
}

function normalizeEmailHash(value: string | null | undefined) {
  return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function normalizeUserId(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized && normalized.length <= 200 ? normalized : undefined;
}

function safeEqual(first: string, second: string) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

function normalizeProductSlug(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();

  return normalized && productSlugPattern.test(normalized) ? normalized : undefined;
}
