import { NextResponse } from "next/server";

import { hasAdminAccess } from "@/lib/auth";
import { getBackendMode } from "@/lib/config";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { getContentSnapshot, saveContentSnapshot } from "@/lib/content-store";
import { createPremiumCodeBatch } from "@/lib/premium-code-batches";
import { getDemoSession } from "@/lib/session.server";
import { renderSharedPremiumQrPdf, renderSharedPremiumQrSvg } from "@/lib/shared-premium-qr";
import { createClient } from "@/lib/supabase/server";
import type { PremiumCode } from "@/lib/types";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ productId: string }> };
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request, { params }: Context) {
  if (!await isAdmin()) return json({ error: "unauthorized" }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "invalid_request" }, 403);
  const { productId } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_request" }, 400); }
  if (!body || typeof body !== "object" || typeof (body as { active?: unknown }).active !== "boolean") return json({ error: "invalid_request" }, 400);
  const active = (body as { active: boolean }).active;
  try {
    if (getBackendMode() === "local") {
      const snapshot = getContentSnapshot();
      const product = snapshot.products.find((item) => item.id === productId);
      if (!product) return json({ error: "not_found" }, 404);
      const current = product.premiumCodes.find((code) => code.codeType === "shared");
      const code: PremiumCode = current ? { ...current, active } : {
        ...createPremiumCodeBatch({ productId, count: 1, existingCodes: snapshot.products.flatMap((item) => item.premiumCodes.map((entry) => entry.code)) })[0],
        codeType: "shared", active,
      };
      saveContentSnapshot({ ...snapshot, products: snapshot.products.map((item) => item.id === productId ? { ...item, premiumCodes: [...item.premiumCodes.filter((entry) => entry.codeType !== "shared"), code] } : item) });
      return json({ ok: true, code }, 200);
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("manage_shared_premium_code", { requested_product_id: productId, requested_active: active });
    if (error) throw new Error("Shared code mutation failed.");
    if (!data) return json({ error: "not_found" }, 404);
    return json({ ok: true, code: { id: data.id, productId: data.product_id, code: data.code, active: data.active, codeType: "shared" } }, 200);
  } catch { return json({ error: "unavailable" }, 503); }
}

export async function GET(request: Request, { params }: Context) {
  if (!await isAdmin()) return json({ error: "unauthorized" }, 401);
  try {
    const { productId } = await params;
    const snapshot = await getAdminContentSnapshot();
    const product = snapshot.products.find((item) => item.id === productId);
    if (!product) return json({ error: "not_found" }, 404);
    const code = product.premiumCodes.find((item) => item.codeType === "shared");
    const url = new URL(request.url);
    const format = url.searchParams.get("format");
    if (!format) return json({ ok: true, code: code ?? null }, 200);
    if (format !== "svg" && format !== "pdf") return json({ error: "invalid_format" }, 400);
    if (!code?.active || product.status !== "published") return json({ error: "publish_and_activate_first" }, 409);
    const contents = format === "svg" ? renderSharedPremiumQrSvg(productId, code.code) : new Uint8Array(await renderSharedPremiumQrPdf(productId, code.code));
    return new NextResponse(contents, { headers: {
      ...privateHeaders,
      "Content-Type": format === "svg" ? "image/svg+xml; charset=utf-8" : "application/pdf",
      "Content-Disposition": `${url.searchParams.get("preview") === "1" ? "inline" : "attachment"}; filename="lamilialomi-kdp-${productId}.${format}"`,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    } });
  } catch { return json({ error: "unavailable" }, 503); }
}

async function isAdmin() {
  try { return hasAdminAccess(await getDemoSession()); } catch { return false; }
}

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}
