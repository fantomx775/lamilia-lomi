import { NextResponse } from "next/server";

import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import { isSupportedLocale } from "@/lib/locale";
import { redeemPremiumCodeForRequest } from "@/lib/premium-request";
import {
  getLocalizedProductViewByIdForRequest,
  getLocalizedProductViewForRequest,
} from "@/lib/products-request";
import {
  clearUnlockIntent,
  getUnlockIntent,
  setUnlockIntent,
} from "@/lib/unlock-intent";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

export async function GET(request: Request, { params }: Props) {
  return enter(request, await params, new URL(request.url).searchParams, 307);
}

export async function POST(request: Request, { params }: Props) {
  const origin = request.headers.get("origin");
  const isLocalOrigin = getBackendMode() === "local" && origin === new URL(request.url).origin;
  if (origin !== getCanonicalAppUrl().origin && !isLocalOrigin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 415 });
  }
  const body = await request.text();
  if (body.length > 2048) {
    return NextResponse.json({ error: "invalid_request" }, { status: 413 });
  }
  return enter(request, await params, new URLSearchParams(body), 303);
}

async function enter(request: Request, { locale, slug }: { locale: string; slug: string }, input: URLSearchParams, status: 303 | 307) {

  if (!isSupportedLocale(locale)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let product;

  try {
    const requestedProductId = input.get("productId") || (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(slug) ? slug : null);
    product = requestedProductId
      ? await getLocalizedProductViewByIdForRequest(requestedProductId, locale)
      : await getLocalizedProductViewForRequest(slug, locale);
  } catch (error) {
    console.error("[qr-unlock] Product lookup failed unexpectedly.", {
      type: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const code = (
    input.get("code") ??
    input.get("premiumCode")
  )?.trim();

  if (code) {
    await setUnlockIntent({
      locale,
      productSlug: product.slug,
      returnTo: `/${locale}/products/${product.slug}`,
      code,
    });
  } else {
    const existingIntent = await getUnlockIntent();

    if (
      existingIntent &&
      (existingIntent.locale !== locale || existingIntent.productSlug !== product.slug)
    ) {
      await clearUnlockIntent();
    }
  }

  const target = new URL(
    `/${locale}/products/${product.slug}`,
    getCanonicalAppUrl(),
  );

  if (code) {
    try {
      const result = await redeemPremiumCodeForRequest({ productId: product.id, productSlug: product.slug, code });
      if (result.ok) {
        await clearUnlockIntent();
      } else if (result.status !== "auth_required" && result.status !== "email_unverified") {
        target.searchParams.set("unlock", result.status);
        await clearUnlockIntent();
      }
    } catch {
      // Keep the intent for a safe retry; never include code/body/URL in logs.
      target.searchParams.set("unlock", "unexpected");
    }
  }

  for (const key of ["step", "unlock", "unlocked"]) {
    const value = requestUrl.searchParams.get(key);

    if (value) {
      target.searchParams.set(key, value.slice(0, 128));
    }
  }

  target.hash = "premium";
  const response = NextResponse.redirect(target, status);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");

  return response;
}
