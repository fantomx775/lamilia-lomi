import { cookies } from "next/headers";

import { normalizeLocale } from "./locale";
import { sanitizeReturnTo } from "./return-to";
import type { Locale } from "@/i18n/routing";

export const unlockIntentCookie = "ll_unlock_intent";
const intentMaxAge = 60 * 10;

export type UnlockIntent = {
  locale: Locale;
  productSlug: string;
  returnTo: string;
  code?: string;
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

    if (typeof parsed.productSlug !== "string" || !parsed.productSlug.trim()) {
      return null;
    }

    const returnTo = sanitizeReturnTo(
      typeof parsed.returnTo === "string" ? parsed.returnTo : undefined,
      locale,
      `/${locale}/products/${parsed.productSlug}`,
    );

    if (!returnTo.includes(`/products/${parsed.productSlug}`)) {
      return null;
    }

    return {
      locale,
      productSlug: parsed.productSlug,
      returnTo,
      code:
        typeof parsed.code === "string" && parsed.code.trim()
          ? parsed.code.trim().slice(0, 128)
          : undefined,
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
  const returnTo = sanitizeReturnTo(
    input.returnTo,
    locale,
    `/${locale}/products/${input.productSlug}`,
  );
  const payload: UnlockIntent = {
    locale,
    productSlug: input.productSlug,
    returnTo,
    code: input.code?.trim().slice(0, 128) || undefined,
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
