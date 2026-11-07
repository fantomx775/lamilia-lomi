import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { routing } from "./i18n/routing";
import { getBackendMode, getRequiredSupabaseEnv } from "./lib/config";
import {
  getEnglishOnlyRedirectUrl,
  isUnlocalizedAuthPath,
  shouldBypassLocaleRouting,
} from "./lib/proxy-paths";
import { hasSupabaseAuthCookie } from "./lib/supabase/auth-cookie";
import { updateSession } from "./lib/supabase/proxy";

const handleI18nRouting = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const englishOnlyRedirect = getEnglishOnlyRedirectUrl(request.nextUrl);

  if (englishOnlyRedirect) {
    return NextResponse.redirect(englishOnlyRedirect, 308);
  }

  const productRedirect = await getHistoricalProductRedirect(request);
  if (productRedirect) {
    return NextResponse.redirect(productRedirect, 308);
  }

  const isAuthRequest = isUnlocalizedAuthPath(pathname);
  const response = shouldBypassLocaleRouting(pathname)
    ? NextResponse.next({ request })
    : handleI18nRouting(request);

  return isAuthRequest ? response : updateSessionIfNeeded(request, response);
}

async function getHistoricalProductRedirect(request: NextRequest) {
  const match = /^\/en\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(request.nextUrl.pathname);
  if (!match || getBackendMode() !== "supabase") return null;

  // Legacy code links still enter the existing redemption flow on the product page.
  if (request.nextUrl.searchParams.has("code") || request.nextUrl.searchParams.has("premiumCode")) {
    return null;
  }

  // Resolve before rendering, while we can still send an HTTP 308 instead of a streamed redirect.
  const slug = match[1];
  const { url, publishableKey } = getRequiredSupabaseEnv();
  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data } = await supabase.from("product_slug_aliases")
    .select("products!inner(slug)")
    .eq("slug", slug)
    .eq("products.status", "published")
    .neq("products.slug", slug)
    .abortSignal(AbortSignal.timeout(1500))
    .maybeSingle<{ products: { slug: string } }>();

  const canonicalSlug = data?.products.slug;
  if (!canonicalSlug || canonicalSlug === slug) return null;

  const target = request.nextUrl.clone();
  target.pathname = `/en/products/${encodeURIComponent(canonicalSlug)}`;
  return target;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
};

function updateSessionIfNeeded(request: NextRequest, response: NextResponse) {
  const isApiRequest = request.nextUrl.pathname.startsWith("/api");

  // Sessions are cookie-backed. A guest page cannot refresh a session it does not have.
  return isApiRequest || hasSupabaseAuthCookie(request.cookies.getAll())
    ? updateSession(request, response)
    : response;
}
