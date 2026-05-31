import { z } from "zod";

import { defaultLocale, normalizeLocale } from "./locale";
import { demoUsers } from "./seed-data";
import type { DemoSession, UserRole } from "./types";

export const registrationSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  termsAccepted: z.boolean(),
  marketingConsent: z.boolean().optional().default(false),
  preferredLocale: z.string().optional(),
});

export type RegistrationInput = z.input<typeof registrationSchema>;

export function validateRegistrationInput(input: RegistrationInput) {
  const parsed = registrationSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  if (!parsed.data.termsAccepted) {
    return {
      ok: false as const,
      errors: {
        termsAccepted: ["Terms and privacy acceptance is required."],
      },
    };
  }

  return {
    ok: true as const,
    value: {
      ...parsed.data,
      marketingConsent: parsed.data.marketingConsent ?? false,
      preferredLocale: normalizeLocale(parsed.data.preferredLocale),
    },
  };
}

export function buildAuthRedirect(input: {
  locale?: string;
  redirectTo?: string | null;
  code?: string | null;
}) {
  const locale = normalizeLocale(input.locale);
  const fallback = `/${locale}/library`;
  const safeRedirect =
    input.redirectTo?.startsWith(`/${locale}/`) || input.redirectTo === `/${locale}`
      ? input.redirectTo
      : fallback;
  const url = new URL(safeRedirect, "http://local.test");

  if (input.code) {
    url.searchParams.set("code", input.code);
  }

  return `${url.pathname}${url.search}`;
}

export function createDemoSession(input: {
  email: string;
  role?: UserRole;
  emailVerified?: boolean;
  marketingConsent?: boolean;
  preferredLocale?: string;
  unlockedProductIds?: string[];
}): DemoSession {
  const knownUser = demoUsers.find(
    (user) => user.email.toLowerCase() === input.email.toLowerCase(),
  );

  return {
    email: input.email.toLowerCase(),
    role: input.role ?? knownUser?.role ?? "user",
    emailVerified: input.emailVerified ?? knownUser?.emailVerified ?? false,
    marketingConsent: input.marketingConsent ?? knownUser?.marketingConsent ?? false,
    termsAcceptedAt: new Date("2026-05-31T09:00:00.000Z").toISOString(),
    preferredLocale: normalizeLocale(input.preferredLocale ?? defaultLocale),
    unlockedProductIds:
      input.unlockedProductIds ?? knownUser?.unlockedProductIds ?? [],
  };
}

export function hasAdminAccess(session?: Pick<DemoSession, "role"> | null) {
  return session?.role === "admin";
}

export function parseDemoSession(value: string | undefined): DemoSession | null {
  if (!value) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    if (
      typeof session.email === "string" &&
      (session.role === "user" || session.role === "admin") &&
      typeof session.emailVerified === "boolean" &&
      Array.isArray(session.unlockedProductIds)
    ) {
      return {
        email: session.email,
        role: session.role,
        emailVerified: session.emailVerified,
        marketingConsent: Boolean(session.marketingConsent),
        termsAcceptedAt:
          typeof session.termsAcceptedAt === "string"
            ? session.termsAcceptedAt
            : new Date().toISOString(),
        preferredLocale: normalizeLocale(session.preferredLocale),
        unlockedProductIds: session.unlockedProductIds.filter(
          (id: unknown): id is string => typeof id === "string",
        ),
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function serializeDemoSession(session: DemoSession) {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}
