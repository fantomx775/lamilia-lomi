"use server";

import { redirect } from "next/navigation";

import { getBackendMode } from "@/lib/config";
import {
  buildAuthRedirect,
  createDemoSession,
  isUnlockRegistrationContext,
  isSupabaseEmailNotConfirmedError,
  validateRegistrationInput,
} from "@/lib/auth";
import {
  authResumeIntentMatchesEmail,
  authResumeIntentMatchesUser,
  buildSupabaseAuthCallbackUrl,
  createAuthResumeIntent,
  clearAuthResumeIntent,
  getAuthResumeRedirect,
  redeemAuthResumeIntent,
  readAuthResumeIntent,
  setAuthResumeIntent,
} from "@/lib/auth-resume";
import type { AuthResumeIntent } from "@/lib/auth-resume";
import { normalizeLocale } from "@/lib/locale";
import { redeemPremiumCodeForRequest } from "@/lib/premium-request";
import { getDemoSession, setDemoSession, clearDemoSession } from "@/lib/session.server";
import { scheduleReviewReminder } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { getProductBySlugForRequest } from "@/lib/products-request";
import { normalizePremiumCodeForRequest } from "@/lib/premium-code";
import {
  clearUnlockIntent,
  getUnlockIntent,
  setUnlockIntent,
} from "@/lib/unlock-intent";
import {
  productSlugFromReturnTo,
  sanitizeReturnTo,
} from "@/lib/return-to";

export async function startUnlockAuthAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const productSlug = text(formData, "productSlug");
  const product = await getProductBySlugForRequest(productSlug);

  if (!product) {
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

export async function loginDemoAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const email = text(formData, "email");
  const password = rawText(formData, "password");
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
  );
  const existingIntent = await getUnlockIntent();
  const returnProductSlug = productSlugFromReturnTo(returnTo, locale);
  const currentIntent =
    existingIntent?.locale === locale && existingIntent.productSlug === returnProductSlug
      ? existingIntent
      : null;

  if (existingIntent && !currentIntent) {
    await clearUnlockIntent();
  }

  const submittedCode = text(formData, "code");
  const formCode = submittedCode || currentIntent?.code || "";

  if (!email || !isValidEmail(email) || !password) {
    redirect(`/${locale}/login?error=invalid_input&returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (getBackendMode() === "supabase") {
    const pendingResumeIntent = await readAuthResumeIntent();
    const pendingResumeTargetsReturnTo = Boolean(
      pendingResumeIntent &&
        (pendingResumeIntent.returnTo === returnTo ||
          (returnProductSlug &&
            pendingResumeIntent.productSlug === returnProductSlug)),
    );
    const pendingResumeMatchesEmail = Boolean(
      pendingResumeTargetsReturnTo &&
        pendingResumeIntent &&
        pendingResumeIntent.userId &&
        authResumeIntentMatchesEmail(pendingResumeIntent, email),
    );
    const pendingResumeAccountMismatch =
      pendingResumeTargetsReturnTo &&
      Boolean(pendingResumeIntent?.userId) &&
      !pendingResumeMatchesEmail;
    const pendingResumeCode = normalizePremiumCodeForRequest(
      pendingResumeIntent?.code,
    );
    const normalizedFormCode = normalizePremiumCodeForRequest(formCode);
    const submittedBoundCodeHasDifferentContext = Boolean(
      pendingResumeIntent?.userId &&
        pendingResumeCode &&
        normalizedFormCode === pendingResumeCode &&
        !pendingResumeMatchesEmail,
    );
    const retryingPendingResume = Boolean(
      pendingResumeMatchesEmail &&
        pendingResumeIntent?.productSlug &&
        pendingResumeIntent.code,
    );
    const pendingResumeIntentForRetry =
      retryingPendingResume && pendingResumeIntent
        ? { ...pendingResumeIntent, code: submittedCode || pendingResumeIntent.code }
        : null;
    if (
      pendingResumeTargetsReturnTo &&
      pendingResumeIntent &&
      !pendingResumeIntent.userId
    ) {
      // An email hash alone is not enough to authorize reuse after a later
      // sign-in. Require the user to enter the code again.
      await clearAuthResumeIntent();
    }
    const code = submittedBoundCodeHasDifferentContext
      ? ""
      : pendingResumeIntentForRetry?.code ?? formCode;
    const preservePendingResumeRetry = async () => {
      if (!pendingResumeIntentForRetry?.userId || !pendingResumeIntentForRetry.code) {
        return;
      }

      await setAuthResumeIntent({
        locale: pendingResumeIntentForRetry.locale,
        productSlug: pendingResumeIntentForRetry.productSlug,
        returnTo: pendingResumeIntentForRetry.returnTo,
        code: pendingResumeIntentForRetry.code,
        userId: pendingResumeIntentForRetry.userId,
        emailHash: pendingResumeIntentForRetry.emailHash,
      });
    };
    let intent = createAuthResumeIntent({
      locale,
      productSlug: returnProductSlug,
      returnTo,
      code,
      email,
    });
    // A premium code must stop living in the unbound guest cookie as soon as
    // it is being carried by an account-bound auth resume intent.
    await clearUnlockIntent();
    const supabase = await createClient();
    let error;

    try {
      ({ error } = await supabase.auth.signInWithPassword({
        email,
        password,
      }));
    } catch (authError) {
      logUnexpectedFailure("[auth] Sign-in failed unexpectedly.", authError);
      await preservePendingResumeRetry();
      redirect(`/${locale}/login?error=invalid_credentials&returnTo=${encodeURIComponent(intent.returnTo)}`);
    }

    if (error) {
      const errorCode = isSupabaseEmailNotConfirmedError(error)
        ? "email_unverified"
        : "invalid_credentials";
      await preservePendingResumeRetry();
      redirect(`/${locale}/login?error=${errorCode}&returnTo=${encodeURIComponent(intent.returnTo)}`);
    }

    if (pendingResumeAccountMismatch || submittedBoundCodeHasDifferentContext) {
      await clearAuthResumeIntent();
    }

    if (
      pendingResumeIntentForRetry?.productSlug &&
      pendingResumeIntentForRetry.code
    ) {
      let pendingUser: Awaited<ReturnType<typeof supabase.auth.getUser>> | null = null;
      try {
        pendingUser = await supabase.auth.getUser();
      } catch (userError) {
        logUnexpectedFailure(
          "[auth] Pending auth resume user lookup failed unexpectedly.",
          userError,
        );
      }

      if (
        !pendingUser ||
        pendingUser.error ||
        !pendingUser.data.user?.email_confirmed_at
      ) {
        await preservePendingResumeRetry();
        redirect(
          `/${locale}/login?error=verification_unavailable&returnTo=${encodeURIComponent(returnTo)}`,
        );
      }

      if (!authResumeIntentMatchesUser(pendingResumeIntentForRetry, pendingUser.data.user)) {
        await clearAuthResumeIntent();
        await clearUnlockIntent();
        redirect(
          `/${locale}/login?error=verification_mismatch&returnTo=${encodeURIComponent(returnTo)}`,
        );
      }

      await completeSupabaseAuthResume(
        pendingResumeIntentForRetry,
        code,
      );
    }

    if (code) {
      let signedInUser: Awaited<ReturnType<typeof supabase.auth.getUser>> | null = null;
      try {
        signedInUser = await supabase.auth.getUser();
      } catch (userError) {
        logUnexpectedFailure("[auth] Sign-in user lookup failed unexpectedly.", userError);
      }

      if (
        !signedInUser ||
        signedInUser.error ||
        !signedInUser.data.user?.email_confirmed_at
      ) {
        redirect(
          `/${locale}/login?error=verification_unavailable&returnTo=${encodeURIComponent(returnTo)}`,
        );
      }

      const signedInIntent = {
        ...intent,
        userId: signedInUser.data.user.id,
      };
      if (!authResumeIntentMatchesUser(signedInIntent, signedInUser.data.user)) {
        await clearAuthResumeIntent();
        await clearUnlockIntent();
        redirect(
          `/${locale}/login?error=verification_mismatch&returnTo=${encodeURIComponent(returnTo)}`,
        );
      }

      intent = signedInIntent;
      await completeSupabaseAuthResume(intent, code);
    }

    redirect(getAuthResumeRedirect(intent, locale));
  }

  await preserveUnlockIntent({ locale, returnTo, code: formCode });
  await setDemoSession(
    createDemoSession({
      email,
      emailVerified: !email.toLowerCase().includes("unverified"),
      preferredLocale: locale,
    }),
  );

  redirect(
    getAuthResumeRedirect(
      { locale, productSlug: returnProductSlug, returnTo },
      locale,
    ),
  );
}

export async function resendSupabaseVerificationEmailAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
  );
  const returnProductSlug = productSlugFromReturnTo(returnTo, locale);
  const code = text(formData, "code");
  const email = text(formData, "email");

  if (!email || !isValidEmail(email)) {
    redirect(`/${locale}/login?error=invalid_input&returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (getBackendMode() !== "supabase") {
    redirect(
      `/${locale}/login?error=verification_required&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  const pendingResumeIntent = await readAuthResumeIntent();
  const pendingResumeTargetsReturnTo = Boolean(
    pendingResumeIntent &&
      (pendingResumeIntent.returnTo === returnTo ||
        (returnProductSlug &&
          pendingResumeIntent.productSlug === returnProductSlug)),
  );
  const pendingResumeMatchesEmail = Boolean(
    pendingResumeTargetsReturnTo &&
      pendingResumeIntent &&
      pendingResumeIntent.userId &&
      authResumeIntentMatchesEmail(pendingResumeIntent, email),
  );
  const pendingResumeAccountMismatch =
    pendingResumeTargetsReturnTo &&
    Boolean(pendingResumeIntent?.userId) &&
    !pendingResumeMatchesEmail;
  const retryingPendingResume = Boolean(
    pendingResumeMatchesEmail &&
      pendingResumeIntent?.productSlug &&
      pendingResumeIntent.code,
  );
  await clearUnlockIntent();
  const intent = createAuthResumeIntent({
    locale,
    productSlug: retryingPendingResume
      ? pendingResumeIntent?.productSlug
      : returnProductSlug,
    returnTo,
    code: retryingPendingResume
      ? pendingResumeIntent?.code
      : pendingResumeAccountMismatch
        ? undefined
        : code || (pendingResumeMatchesEmail ? pendingResumeIntent?.code : undefined),
    userId: pendingResumeMatchesEmail ? pendingResumeIntent?.userId : undefined,
    emailHash: pendingResumeMatchesEmail ? pendingResumeIntent?.emailHash : undefined,
    email: text(formData, "email"),
  });
  if (intent.userId) {
    await setAuthResumeIntent({
      locale: intent.locale,
      productSlug: intent.productSlug,
      returnTo: intent.returnTo,
      code: intent.code,
      userId: intent.userId,
      emailHash: intent.emailHash,
      email,
    });
  } else {
    // Keep the code only in the signed callback token until confirmation
    // establishes the account ID. An email-only cookie must not authorize a
    // later login to reuse it.
    await clearAuthResumeIntent();
  }
  const supabase = await createClient();
  let resendError;

  try {
    ({ error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: buildSupabaseAuthCallbackUrl(locale, returnTo, intent) },
    }));
  } catch (error) {
    logUnexpectedFailure("[auth] Verification email resend failed unexpectedly.", error);
    resendError = true;
  }

  if (resendError) {
    redirect(
      `/${locale}/login?error=verification_unavailable&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  redirect(
    `/${locale}/login?error=verification_sent&returnTo=${encodeURIComponent(returnTo)}`,
  );
}

export async function registerDemoAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
    `/${locale}/account`,
  );
  let code = text(formData, "code");
  const isUnlockContext = isUnlockRegistrationContext({ locale, redirectTo: returnTo });

  await preserveUnlockIntent({ locale, returnTo, code });

  const result = validateRegistrationInput({
    email: text(formData, "email"),
    password: rawText(formData, "password"),
    termsAccepted: formData.get("termsAccepted") === "on",
    marketingConsent: formData.get("marketingConsent") === "on",
    preferredLocale: locale,
  });

  if (!result.ok) {
    redirect(`/${locale}/register?error=invalid&returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (getBackendMode() === "supabase") {
    const pendingResumeIntent = await readAuthResumeIntent();
    const returnProductSlug = productSlugFromReturnTo(returnTo, locale);
    const pendingResumeTargetsReturnTo = Boolean(
      pendingResumeIntent &&
        (pendingResumeIntent.returnTo === returnTo ||
          (returnProductSlug &&
            pendingResumeIntent.productSlug === returnProductSlug)),
    );
    const pendingResumeMatchesAccount = Boolean(
      pendingResumeTargetsReturnTo &&
        pendingResumeIntent &&
        pendingResumeIntent.userId &&
        authResumeIntentMatchesEmail(pendingResumeIntent, result.value.email),
    );
    const pendingResumeHasDifferentAccount = Boolean(
      pendingResumeIntent &&
        pendingResumeIntent.userId &&
        pendingResumeIntent?.code &&
        !pendingResumeMatchesAccount,
    );
    if (
      pendingResumeTargetsReturnTo &&
      pendingResumeIntent &&
      !pendingResumeIntent.userId
    ) {
      // A retained email hash cannot authorize reuse during a new registration.
      // The user may enter the code again explicitly in this form.
      await clearAuthResumeIntent();
    }
    const normalizedCode = normalizePremiumCodeForRequest(code);
    const normalizedPendingCode = normalizePremiumCodeForRequest(
      pendingResumeIntent?.code,
    );
    const submittedPendingCode = Boolean(
      normalizedCode && normalizedCode === normalizedPendingCode,
    );
    const reusingPendingResumeCode = Boolean(
      pendingResumeMatchesAccount &&
        normalizedPendingCode &&
        (!normalizedCode || submittedPendingCode),
    );
    if (pendingResumeHasDifferentAccount && submittedPendingCode) {
      code = "";
    } else if (!normalizedCode && pendingResumeMatchesAccount) {
      code = pendingResumeIntent?.code ?? "";
    }
    let intent = createAuthResumeIntent({
      locale,
      returnTo,
      code,
      email: result.value.email,
      userId: reusingPendingResumeCode ? pendingResumeIntent?.userId : undefined,
    });
    const safeRedirectTo = intent.returnTo;
    await clearUnlockIntent();
    const supabase = await createClient();
    let data;
    let error;

    try {
      ({ data, error } = await supabase.auth.signUp({
        email: result.value.email,
        password: result.value.password,
        options: {
          data: {
            marketing_consent: result.value.marketingConsent,
            preferred_locale: result.value.preferredLocale,
            terms_accepted: true,
          },
          emailRedirectTo: buildSupabaseAuthCallbackUrl(locale, safeRedirectTo, intent),
        },
      }));
    } catch (authError) {
      logUnexpectedFailure("[auth] Registration failed unexpectedly.", authError);
      redirect(`/${locale}/register?error=auth&returnTo=${encodeURIComponent(safeRedirectTo)}`);
    }

    if (error) {
      redirect(`/${locale}/register?error=auth&returnTo=${encodeURIComponent(safeRedirectTo)}`);
    }

    if (
      reusingPendingResumeCode &&
      pendingResumeIntent?.userId &&
      data.user?.id !== pendingResumeIntent.userId
    ) {
      // A matching email is not proof that registration returned the same
      // account that owns the saved code.
      code = "";
    }

    intent = createAuthResumeIntent({
      locale,
      returnTo: safeRedirectTo,
      code,
      email: result.value.email,
      userId: data.user?.id,
    });
    if (data.user?.id) {
      await setAuthResumeIntent({
        locale,
        returnTo: safeRedirectTo,
        code,
        email: result.value.email,
        userId: data.user.id,
      });
    } else {
      await clearAuthResumeIntent();
    }

    if (data.session && intent.userId) {
      await completeSupabaseAuthResume(intent, code);
    }

    if (isUnlockContext) {
      redirect(appendQueryPath(getAuthResumeRedirect(intent, locale), "step", "verify"));
    }

    redirect(
      `/${locale}/login?error=verification_sent&returnTo=${encodeURIComponent(safeRedirectTo)}`,
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

async function completeSupabaseAuthResume(intent: AuthResumeIntent, code: string) {
  await setAuthResumeIntent({
    locale: intent.locale,
    productSlug: intent.productSlug,
    returnTo: intent.returnTo,
    code,
    userId: intent.userId,
    emailHash: intent.emailHash,
  });

  let redemption;
  try {
    redemption = await redeemAuthResumeIntent(intent);
  } catch (error) {
    logUnexpectedFailure("[premium-unlock] Auth resume redemption failed unexpectedly.", error);
    await setUnlockIntent({
      locale: intent.locale,
      productSlug: intent.productSlug ?? "",
      returnTo: intent.returnTo,
    });
    redirect(
      appendQueryPath(getAuthResumeRedirect(intent, intent.locale), "unlock", "unexpected"),
    );
  }
  const resumeRedirect = getAuthResumeRedirect(intent, intent.locale);

  if (redemption?.ok) {
    await clearAuthResumeIntent();
    await clearUnlockIntent();
    if (redemption.status === "success") {
      const product = intent.productSlug
        ? await getProductBySlugForRequest(intent.productSlug)
        : null;
      scheduleReviewReminder({
        unlockedAt: new Date(),
        delayDays: product?.reviewDelayDays,
      });
    }
    redirect(
      appendQueryPath(
        resumeRedirect,
        "unlocked",
        redemption.status === "already_unlocked" ? "already" : "1",
      ),
    );
  }

  if (redemption && !redemption.ok) {
    await setUnlockIntent({
      locale: intent.locale,
      productSlug: intent.productSlug ?? "",
      returnTo: intent.returnTo,
    });

    if (redemption.status === "email_unverified") {
      redirect(appendQueryPath(resumeRedirect, "step", "verify"));
    }

    redirect(appendQueryPath(resumeRedirect, "unlock", redemption.status));
  }

  await clearAuthResumeIntent();
  redirect(resumeRedirect);
}

export async function verifyDemoEmailAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const returnTo = sanitizeReturnTo(
    text(formData, "returnTo") || text(formData, "redirectTo"),
    locale,
    `/${locale}/account`,
  );

  if (getBackendMode() === "supabase") {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();

    if (!data.user) {
      redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
    }

    redirect(
      data.user.email_confirmed_at
        ? returnTo
        : appendQueryPath(returnTo, "step", "verify"),
    );
  }

  const session = await getDemoSession();

  if (!session) {
    redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  await setDemoSession({ ...session, emailVerified: true });
  redirect(buildAuthRedirect({ locale, redirectTo: returnTo }));
}

export async function logoutAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));

  await clearDemoSession();
  await clearUnlockIntent();
  await clearAuthResumeIntent();
  redirect(`/${locale}`);
}

export async function unlockPremiumAction(formData: FormData) {
  const locale = normalizeLocale(text(formData, "locale"));
  const productSlug = text(formData, "productSlug");
  const product = await getProductBySlugForRequest(productSlug);
  const existingIntent = await getUnlockIntent();
  const code =
    text(formData, "code") ||
    (existingIntent?.locale === locale && existingIntent.productSlug === productSlug
      ? existingIntent.code
      : undefined) ||
    "";

  if (!product) {
    redirect(`/${locale}/products?unlock=product_not_found`);
  }

  const returnTo = `/${locale}/products/${product.slug}`;
  const premiumReturnTo = buildAuthRedirect({ locale, redirectTo: returnTo });

  const session = await getDemoSession();

  if (!session) {
    await setUnlockIntent({ locale, productSlug: product.slug, returnTo, code });
    redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (getBackendMode() === "supabase") {
    const pendingResumeIntent = await readAuthResumeIntent();
    const pendingResumeCode = normalizePremiumCodeForRequest(pendingResumeIntent?.code);
    const submittedCode = normalizePremiumCodeForRequest(code);
    const submittedCodeMatchesOtherAccount = Boolean(
      pendingResumeIntent?.userId &&
        pendingResumeCode &&
        submittedCode &&
        pendingResumeCode === submittedCode &&
        !authResumeIntentMatchesUser(pendingResumeIntent, {
          id: session.userId,
          email: session.email,
        }),
    );

    if (submittedCodeMatchesOtherAccount) {
      await clearAuthResumeIntent();
      await clearUnlockIntent();
      redirect(
        `/${locale}/login?error=verification_mismatch&returnTo=${encodeURIComponent(returnTo)}`,
      );
    }
  }

  if (!session.emailVerified) {
    await preserveUnlockRecoveryIntent({
      locale,
      productSlug: product.slug,
      returnTo,
      code,
      email: session.email,
      userId: session.userId,
    });
    redirect(appendQueryPath(premiumReturnTo, "step", "verify"));
  }

  let result;
  try {
    result = await redeemPremiumCodeForRequest({
      productSlug,
      productId: product.id,
      code,
    });
  } catch (error) {
    logUnexpectedFailure("[premium-unlock] Redemption failed unexpectedly.", error);
    await preserveUnlockRecoveryIntent({
      locale,
      productSlug: product.slug,
      returnTo,
      code,
      email: session.email,
      userId: session.userId,
    });
    redirect(appendQueryPath(premiumReturnTo, "unlock", "unexpected"));
  }

  if (!result.ok) {
    if (result.status === "auth_required") {
      await preserveUnlockRecoveryIntent({
        locale,
        productSlug: product.slug,
        returnTo,
        code,
        email: session.email,
        userId: session.userId,
      });
      redirect(`/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`);
    }

    if (result.status === "email_unverified") {
      await preserveUnlockRecoveryIntent({
        locale,
        productSlug: product.slug,
        returnTo,
        code,
        email: session.email,
        userId: session.userId,
      });
      redirect(appendQueryPath(premiumReturnTo, "step", "verify"));
    }

    await preserveUnlockRecoveryIntent({
      locale,
      productSlug: product.slug,
      returnTo,
      code,
      email: session.email,
      userId: session.userId,
    });
    redirect(appendQueryPath(premiumReturnTo, "unlock", result.status));
  }

  await clearUnlockIntent();
  if (getBackendMode() === "supabase") {
    const pendingResumeIntent = await readAuthResumeIntent();
    if (
      pendingResumeIntent?.productSlug === product.slug &&
      pendingResumeIntent.userId === session.userId &&
      authResumeIntentMatchesEmail(pendingResumeIntent, session.email)
    ) {
      await clearAuthResumeIntent();
    }
  }
  if (result.status === "success") {
    scheduleReviewReminder({ unlockedAt: new Date(), delayDays: product.reviewDelayDays });
  }
  redirect(
    appendQueryPath(
      premiumReturnTo,
      "unlocked",
      result.status === "already_unlocked" ? "already" : "1",
    ),
  );
}

async function preserveUnlockRecoveryIntent(input: {
  locale: string;
  productSlug: string;
  returnTo: string;
  code: string;
  email?: string;
  userId?: string;
}) {
  if (getBackendMode() !== "supabase") {
    await setUnlockIntent({
      locale: input.locale,
      productSlug: input.productSlug,
      returnTo: input.returnTo,
      code: input.code,
    });
    return;
  }

  await clearUnlockIntent();

  if (input.email && input.userId && input.code) {
    const existingResumeIntent = await readAuthResumeIntent();
    const existingResumeCode = normalizePremiumCodeForRequest(existingResumeIntent?.code);
    const requestedCode = normalizePremiumCodeForRequest(input.code);
    const sameAccount = Boolean(
      existingResumeIntent &&
        authResumeIntentMatchesUser(existingResumeIntent, {
          id: input.userId,
          email: input.email,
        }),
    );

    if (
      existingResumeIntent &&
      existingResumeCode &&
      existingResumeCode === requestedCode &&
      existingResumeIntent.productSlug !== input.productSlug &&
      sameAccount
    ) {
      return;
    }

    await setAuthResumeIntent({
      locale: input.locale,
      productSlug: input.productSlug,
      returnTo: input.returnTo,
      code: input.code,
      userId: input.userId,
      email: input.email,
    });
  } else {
    await clearAuthResumeIntent();
  }

  await setUnlockIntent({
    locale: input.locale,
    productSlug: input.productSlug,
    returnTo: input.returnTo,
  });
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

  const product = await getProductBySlugForRequest(productSlug);

  if (!product) {
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
      (existing?.locale === input.locale && existing.productSlug === product.slug
        ? existing.code
        : undefined),
  });
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function rawText(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function appendQueryPath(path: string, key: string, value: string) {
  const url = new URL(path, "http://lamilialomi.local");
  url.searchParams.set(key, value);

  return `${url.pathname}${url.search}${url.hash}`;
}

function logUnexpectedFailure(message: string, error: unknown) {
  console.error(message, {
    type: error instanceof Error ? error.name : typeof error,
  });
}
