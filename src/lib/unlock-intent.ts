import { cookies } from "next/headers";

import { normalizeLocale } from "./locale";
import {
  normalizePremiumCodeForRequest,
} from "./premium-code";
import { productSlugFromReturnTo, sanitizeReturnTo } from "./return-to";
import type { Locale } from "@/i18n/routing";

export const unlockIntentCookie = "ll_unlock_intent";
const intentMaxAge = 60 * 10;

export type UnlockIntent = {
  locale: Locale;
  productSlug: string;
  returnTo: string;
  code?: string;
  createdAt: number;
};

export async function getUnlockIntent(): Promise<UnlockIntent | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(unlockIntentCookie)?.value;

  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<UnlockIntent>;
    const locale = normalizeLocale(parsed.locale);
    const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;

    const productSlug = normalizeProductSlug(parsed.productSlug);

    if (
      !productSlug ||
      !createdAt ||
      Date.now() - createdAt > intentMaxAge * 1000 ||
      Date.now() - createdAt < 0
    ) {
      return null;
    }

    const returnTo = sanitizeReturnTo(
      typeof parsed.returnTo === "string" ? parsed.returnTo : undefined,
      locale,
      `/${locale}/products/${productSlug}`,
    );

    if (productSlugFromReturnTo(returnTo, locale) !== productSlug) {
      return null;
    }

    return {
      locale,
      productSlug,
      returnTo,
      code: normalizePremiumCodeForRequest(
        typeof parsed.code === "string" ? parsed.code : undefined,
      ) || undefined,
      createdAt,
    };
  } catch {
    return null;
  }
}

export async function setUnlockIntent(input: {
  locale: string;
  productSlug: string;
  returnTo?: string | null;
  code?: string | null;
}) {
  const locale = normalizeLocale(input.locale);
  const productSlug = normalizeProductSlug(input.productSlug);

  if (!productSlug) {
    await clearUnlockIntent();
    return;
  }

  const returnTo = sanitizeReturnTo(
    input.returnTo,
    locale,
    `/${locale}/products/${productSlug}`,
  );
  const payload: UnlockIntent = {
    locale,
    productSlug,
    returnTo,
    code: normalizePremiumCodeForRequest(input.code) || undefined,
    createdAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const cookieStore = await cookies();

  cookieStore.set(unlockIntentCookie, encoded, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: intentMaxAge,
    path: "/",
  });
}

export async function clearUnlockIntent() {
  const cookieStore = await cookies();

  cookieStore.delete(unlockIntentCookie);
}

function normalizeProductSlug(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : undefined;
}
