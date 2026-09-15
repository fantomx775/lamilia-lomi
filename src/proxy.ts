import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "./i18n/routing";
import { hasSupabaseAuthCookie } from "./lib/supabase/auth-cookie";
import { updateSession } from "./lib/supabase/proxy";
import { getBackendMode } from "./lib/config";

const handleI18nRouting = createMiddleware(routing);
const productPath = /^\/(en|pl|de|es)\/products\/([^/]+)\/?$/;

const notFoundCopy = {
  en: {
    title: "Product not found",
    description: "This product page is no longer available.",
    catalog: "Browse catalog",
  },
  pl: {
    title: "Nie znaleziono produktu",
    description: "Ta strona produktu nie jest już dostępna.",
    catalog: "Przeglądaj katalog",
  },
  de: {
    title: "Produkt nicht gefunden",
    description: "Diese Produktseite ist nicht mehr verfügbar.",
    catalog: "Katalog ansehen",
  },
  es: {
    title: "Producto no encontrado",
    description: "Esta página de producto ya no está disponible.",
    catalog: "Ver el catálogo",
  },
} as const;

export default async function proxy(request: NextRequest) {
  let response = request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/api")
    ? NextResponse.next({ request })
    : handleI18nRouting(request);

  const match = request.nextUrl.pathname.match(productPath);

  if (request.method === "GET" && match && !isAppRouterRequest(request)) {
    const locale = match[1] as keyof typeof notFoundCopy;
    let slug: string;

    try {
      slug = decodeURIComponent(match[2]);
    } catch {
      response = productNotFoundResponse(locale, response);
      return updateSessionIfNeeded(request, response);
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      response = productNotFoundResponse(locale, response);
      return updateSessionIfNeeded(request, response);
    }

    const exists = await isPublishedProductSlug(slug);

    if (exists === false) {
      response = productNotFoundResponse(locale, response);
    }
  }

  return updateSessionIfNeeded(request, response);
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
};

function isAppRouterRequest(request: NextRequest) {
  return (
    request.headers.get("rsc") === "1" ||
    request.headers.has("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch"
  );
}

function updateSessionIfNeeded(request: NextRequest, response: NextResponse) {
  const isApiRequest = request.nextUrl.pathname.startsWith("/api");

  // Sessions are cookie-backed. A guest page cannot refresh a session it does not have.
  return isApiRequest || hasSupabaseAuthCookie(request.cookies.getAll())
    ? updateSession(request, response)
    : response;
}

async function isPublishedProductSlug(slug: string): Promise<boolean | null> {
  let backendMode: ReturnType<typeof getBackendMode>;

  try {
    backendMode = getBackendMode();
  } catch {
    return null;
  }

  if (backendMode === "local") {
    try {
      const { getContentSnapshot } = await import("./lib/content-store");
      return getContentSnapshot().products.some(
        (product) => product.slug === slug && product.status === "published",
      );
    } catch {
      return null;
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase
    .from("products")
    .select("id")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  return error ? null : Boolean(data);
}

function productNotFoundResponse(
  locale: keyof typeof notFoundCopy,
  middlewareResponse: NextResponse,
) {
  const copy = notFoundCopy[locale];
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${copy.title} | LamiliaLomi</title><style>*,*::before,*::after{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7f4ee;color:#302b28;font-family:Arial,sans-serif}.card{width:min(100%,36rem);padding:40px;border:1px solid #e3d9cf;border-radius:16px;background:#fffdf9;text-align:center;box-shadow:0 18px 46px rgba(62,52,47,.1)}h1{font-family:Georgia,serif;font-size:clamp(2rem,6vw,3rem);line-height:1.1}p{color:#766d66;line-height:1.7}a{display:inline-block;margin-top:16px;padding:12px 18px;border-radius:8px;background:#302b28;color:#fff;text-decoration:none}a:focus-visible{outline:3px solid #bd725e;outline-offset:3px}</style></head><body><main class="card"><h1>${copy.title}</h1><p>${copy.description}</p><a href="/${locale}/products">${copy.catalog}</a></main></body></html>`;

  const response = new NextResponse(html, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });

  middlewareResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));

  return response;
}
