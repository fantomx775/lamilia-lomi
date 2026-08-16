"use server";

import { redirect } from "next/navigation";

import {
  buildAuthRedirect,
  createDemoSession,
  isUnlockRegistrationContext,
  validateRegistrationInput,
} from "@/lib/auth";
import { isSupportedLocale, normalizeLocale } from "@/lib/locale";
import { getProductBySlug, isPublicProduct } from "@/lib/products";
import { applyProductUnlock, validatePremiumCode } from "@/lib/premium";
import {
  clearUnlockIntent,
  getUnlockIntent,
  setUnlockIntent,
} from "@/lib/unlock-intent";
import {
  productSlugFromReturnTo,
  sanitizeReturnTo,
  switchLocalePath,
} from "@/lib/return-to";
import { scheduleReviewReminder } from "@/lib/reminders";
import { clearDemoSession, getDemoSession, setDemoSession } from "@/lib/session.server";

export async function startUnlockAuthAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const productSlug = text(formData, "productSlug");
  const product = getProductBySlug(productSlug);

  if (!product || !isPublicProduct(product)) {
    redirect(`/${locale}/products?unlock=product_not_found`);
  }

  const returnTo = `/${locale}/products/${product.slug}`;
  const mode = text(formData, "mode") === "register" ? "register" : "login";

  await setUnlockIntent({
    locale,
    productSlug: product.slug,
    returnTo,
    code: text(formData, "code"),
  });

  redirect(`/${locale}/${mode}?returnTo=${encodeURIComponent(returnTo)}`);
}

export async function switchLocaleAction(formData: FormData) {
  const sourceLocaleInput = text(formData, "sourceLocale");
  const targetLocaleInput = text(formData, "targetLocale");

  if (!isSupportedLocale(sourceLocaleInput) || !isSupportedLocale(targetLocaleInput)) {
    redirect("/en/library");
  }

  const sourceLocale = sourceLocaleInput;
  const targetLocale = targetLocaleInput;
  let currentUrl: URL;

  try {
    currentUrl = new URL(
      `${text(formData, "pathname")}${withSearchPrefix(text(formData, "search"))}`,
      "http://lamilialomi.local",
    );
  } catch {
    redirect(`/${targetLocale}/library`);
  }
  const safeCurrent = sanitizeReturnTo(
    `${currentUrl.pathname}${currentUrl.search}`,
    sourceLocale,
    `/${sourceLocale}/library`,
  );
  const safeCurrentUrl = new URL(safeCurrent, "http://lamilialomi.local");
  const productSlug = productSlugFromReturnTo(safeCurrent, sourceLocale);
  const nestedReturnTo =
    currentUrl.searchParams.get("returnTo") ?? currentUrl.searchParams.get("redirectTo");
  const safeNestedReturnTo = nestedReturnTo
    ? sanitizeReturnTo(nestedReturnTo, sourceLocale, `/${sourceLocale}/library`)
    : undefined;
  const nestedProductSlug = safeNestedReturnTo
    ? productSlugFromReturnTo(safeNestedReturnTo, sourceLocale)
    : undefined;
  const contextProductSlug = productSlug ?? nestedProductSlug;
  const translatedPath = switchLocalePath(
    safeCurrentUrl.pathname,
    sourceLocale,
    targetLocale,
  );
  const translatedNestedReturnTo = safeNestedReturnTo
    ? switchLocalePath(safeNestedReturnTo, sourceLocale, targetLocale)
    : undefined;
  const targetSearchParams = new URLSearchParams();

  for (const key of ["returnTo", "redirectTo", "error", "unlock", "step", "unlocked"]) {
    const value = currentUrl.searchParams.get(key);

    if (!value) {
      continue;
    }

    if ((key === "returnTo" || key === "redirectTo") && translatedNestedReturnTo) {
      targetSearchParams.set(key, translatedNestedReturnTo);
    } else if (key !== "returnTo" && key !== "redirectTo") {
      targetSearchParams.set(key, value.slice(0, 128));
    }
  }

  const targetPath = `${translatedPath}${targetSearchParams.toString() ? `?${targetSearchParams}` : ""}`;

  if (contextProductSlug) {
    const product = getProductBySlug(contextProductSlug);

    if (!product || !isPublicProduct(product)) {
      await clearUnlockIntent();
      redirect(`/${targetLocale}/products`);
    }

    const existingIntent = await getUnlockIntent();
    const code = productSlug
      ? currentUrl.searchParams.get("code") ??
        currentUrl.searchParams.get("premiumCode") ??
        undefined
      : undefined;
    const returnTo = productSlug ? targetPath : translatedNestedReturnTo;

    await setUnlockIntent({
      locale: targetLocale,
      productSlug: product.slug,
      returnTo,
      code:
        code ||
        (existingIntent?.productSlug === product.slug ? existingIntent.code : undefined),
    });
  } else if (productSlug) {
    await clearUnlockIntent();
  }

  redirect(targetPath);
}

export async function loginDemoAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
  );
  const code = text(formData, "code");

  await preserveUnlockIntent({ locale, returnTo, code });

  await setDemoSession(
    createDemoSession({
      email: text(formData, "email") || "demo@lamilialomi.test",
      emailVerified: !text(formData, "email").toLowerCase().includes("unverified"),
      preferredLocale: locale,
    }),
  );

  redirect(buildAuthRedirect({ locale, redirectTo: returnTo }));
}

export async function registerDemoAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
  );
  const code = text(formData, "code");

  if (!isUnlockRegistrationContext({ locale, redirectTo: returnTo })) {
    redirect(`/${locale}/products`);
  }

  await preserveUnlockIntent({ locale, returnTo, code });

  const result = validateRegistrationInput({
    email: text(formData, "email"),
    password: text(formData, "password"),
    termsAccepted: formData.get("termsAccepted") === "on",
    marketingConsent: formData.get("marketingConsent") === "on",
    preferredLocale: locale,
  });

  if (!result.ok) {
    redirect(
      `/${locale}/register?error=invalid&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  await setDemoSession(
    createDemoSession({
      email: result.value.email,
      emailVerified: false,
      marketingConsent: result.value.marketingConsent,
      preferredLocale: locale,
    }),
  );
  redirect(buildAuthRedirect({ locale, redirectTo: returnTo }));
}

export async function verifyDemoEmailAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
    `/${locale}/account`,
  );
  const session = await getDemoSession();

  if (!session) {
    redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (!session.emailVerified) {
    await setDemoSession({ ...session, emailVerified: true });
  }

  redirect(buildAuthRedirect({ locale, redirectTo: returnTo }));
}

export async function logoutAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));

  await clearDemoSession();
  await clearUnlockIntent();
  redirect(`/${locale}`);
}

export async function unlockPremiumAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const productSlug = text(formData, "productSlug");
  const product = getProductBySlug(productSlug);
  const returnTo = `/${locale}/products/${productSlug}`;
  const existingIntent = await getUnlockIntent();
  const code = text(formData, "code") || existingIntent?.code || "";

  if (!product || !isPublicProduct(product)) {
    redirect(`/${locale}/products?unlock=product_not_found`);
  }

  const session = await getDemoSession();

  if (!session) {
    await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
    redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (!session.emailVerified) {
    await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
    redirect(`${returnTo}?step=verify`);
  }

  let result;

  try {
    result = validatePremiumCode({ productSlug: product.slug, code, session });
  } catch {
    await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
    redirect(`${returnTo}?unlock=unexpected`);
  }

  if (!result.ok) {
    await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
    redirect(`${returnTo}?unlock=${result.reason}`);
  }

  const unlock = applyProductUnlock(session, result.productId);

  if (unlock.alreadyUnlocked) {
    await clearUnlockIntent();
    redirect(`${returnTo}?unlocked=already`);
  }

  try {
    await setDemoSession({ ...session, unlockedProductIds: unlock.unlockedProductIds });
  } catch {
    await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
    redirect(`${returnTo}?unlock=unexpected`);
  }

  await clearUnlockIntent();
  scheduleReviewReminder({ unlockedAt: new Date(), delayDays: product.reviewDelayDays });
  redirect(`${returnTo}?unlocked=1`);
}

async function preserveUnlockIntent(input: {
  locale: string;
  returnTo: string;
  code?: string;
}) {
  const productSlug = productSlugFromReturnTo(input.returnTo, input.locale);

  if (!productSlug) {
    await clearUnlockIntent();
    return;
  }

  const product = getProductBySlug(productSlug);

  if (!product || !isPublicProduct(product)) {
    await clearUnlockIntent();
    return;
  }

  const existing = await getUnlockIntent();

  await setUnlockIntent({
    locale: input.locale,
    productSlug: product.slug,
    returnTo: input.returnTo,
    code:
      input.code ||
      (existing?.productSlug === product.slug ? existing.code : undefined),
  });
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function withSearchPrefix(value: string) {
  if (!value) {
    return "";
  }

  return value.startsWith("?") ? value : `?${value}`;
}
