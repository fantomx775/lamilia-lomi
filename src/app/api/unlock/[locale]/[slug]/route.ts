import { NextResponse } from "next/server";

import { isSupportedLocale } from "@/lib/locale";
import { getLocalizedProductViewForRequest } from "@/lib/products-request";
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
  const { locale, slug } = await params;

  if (!isSupportedLocale(locale)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const product = await getLocalizedProductViewForRequest(slug, locale);

  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const code = (
    requestUrl.searchParams.get("code") ??
    requestUrl.searchParams.get("premiumCode")
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
    getRequestOrigin(request, requestUrl),
  );

  for (const key of ["step", "unlock", "unlocked"]) {
    const value = requestUrl.searchParams.get(key);

    if (value) {
      target.searchParams.set(key, value.slice(0, 128));
    }
  }

  target.hash = "premium";
  const response = NextResponse.redirect(target, 307);
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}

function getRequestOrigin(request: Request, requestUrl: URL) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0] ?? requestUrl.protocol.slice(0, -1);

  return host ? `${protocol}://${host}` : requestUrl.origin;
}
