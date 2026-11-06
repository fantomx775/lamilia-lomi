import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { isSupportedLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

// A standalone document deliberately avoids the application layout and analytics.
// Fragments never reach the HTTP server. Scrub them before the first POST/navigation.
export async function GET(request: Request, { params }: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isSupportedLocale(locale) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return new Response("Not found", { status: 404 });
  }
  const endpoint = `/api/unlock/${locale}/${slug}`;
  const url = new URL(request.url);
  // Compatibility for previously printed query-string links.
  if (url.searchParams.has("code") || url.searchParams.has("premiumCode")) {
    const target = new URL(endpoint, url.origin);
    for (const key of ["productId", "code", "premiumCode"]) {
      const value = url.searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    }
    return NextResponse.redirect(target, {
      status: 307,
      headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
  }
  const script = `(()=>{const p=new URLSearchParams(location.hash.slice(1));const code=p.get('code')||p.get('premiumCode')||'';const productId=p.get('productId')||'';history.replaceState(null,'',location.pathname);const form=document.getElementById('qr');for(const [name,value] of [['code',code],['productId',productId]]){const i=document.createElement('input');i.type='hidden';i.name=name;i.value=value;form.appendChild(i);}form.requestSubmit();})();`;
  const hash = createHash("sha256").update(script).digest("base64");
  return new Response(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>Opening your book | LamiliaLomi</title></head><body><p>Opening your book…</p><form id="qr" method="post" action="${endpoint}"></form><noscript><p>Enable JavaScript to open this QR securely, or open the book and enter the printed premium code.</p><a href="${endpoint}">Open book</a></noscript><script>${script}</script></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "same-origin",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${hash}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}
