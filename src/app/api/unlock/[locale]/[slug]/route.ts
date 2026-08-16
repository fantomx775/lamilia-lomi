import { NextResponse } from "next/server";

import { isSupportedLocale } from "@/lib/locale";
import { getProductBySlug, isPublicProduct } from "@/lib/products";
import {
  clearUnlockIntent,
  getUnlockIntent,
  setUnlockIntent,
} from "@/lib/unlock-intent";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

export async function GET(request: Request, { params }: Props) {
  const { locale, slug } = await params;
  const product = getProductBySlug(slug);

  if (!isSupportedLocale(locale) || !product || !isPublicProduct(product)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code")?.trim();

  if (code) {
    await setUnlockIntent({
      locale,
      productSlug: product.slug,
      returnTo: `/${locale}/products/${product.slug}`,
      code,
    });
  } else {
    const existingIntent = await getUnlockIntent();

    if (existingIntent && existingIntent.productSlug !== product.slug) {
      await clearUnlockIntent();
    }
  }

  const response = new NextResponse(null, { status: 307 });
  response.headers.set("Location", `/${locale}/products/${product.slug}#premium`);

  return response;
}
