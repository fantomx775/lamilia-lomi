import { NextResponse } from "next/server";

import { hasAdminAccess } from "@/lib/auth";
import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { getContentSnapshot, saveContentSnapshot } from "@/lib/content-store";
import { MAX_PREMIUM_CODE_LENGTH, normalizePremiumCode } from "@/lib/premium-code";
import { getDemoSession } from "@/lib/session.server";
import { renderSharedPremiumQrPdf, renderSharedPremiumQrSvg } from "@/lib/shared-premium-qr";
import { createClient } from "@/lib/supabase/server";
import type { PremiumCode } from "@/lib/types";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ productId: string }> };
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request, { params }: Context) {
  if (!await isAdmin()) return json({ error: "unauthorized" }, 401);
  if (!isTrustedOrigin(request)) return json({ error: "invalid_request" }, 403);
  const { productId } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_request" }, 400); }
  if (!body || typeof body !== "object" || typeof (body as { active?: unknown }).active !== "boolean") return json({ error: "invalid_request" }, 400);
  const active = (body as { active: boolean }).active;
  const rawCode = typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code.trim() : null;
  if (rawCode && !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(rawCode)) return json({ error: "invalid_code_format" }, 400);
  if (rawCode && (rawCode.length < 3 || rawCode.length > MAX_PREMIUM_CODE_LENGTH)) return json({ error: "invalid_code_length" }, 400);
  const requestedCode = rawCode ? rawCode.toUpperCase() : null;
  try {
    const currentSharedCode = await getExistingSharedCode(productId);
    const codeId = (body as { codeId?: unknown }).codeId;
    if (codeId !== undefined && codeId !== currentSharedCode?.id) return json({ error: "code_not_found" }, 404);
    const codeForMutation = active && requestedCode ? requestedCode : currentSharedCode?.code;
    if (!codeForMutation) return json({ error: active ? "code_required" : "code_not_found" }, active ? 400 : 404);
    if (getBackendMode() === "local") {
      const snapshot = getContentSnapshot();
      const product = snapshot.products.find((item) => item.id === productId);
      if (!product) return json({ error: "not_found" }, 404);
      const current = product.premiumCodes.find((code) => code.codeType === "shared" && !code.retiredAt);
      if (current && normalizePremiumCode(current.code) !== normalizePremiumCode(codeForMutation)) return json({ error: "code_immutable" }, 409);
      if (!current && snapshot.products.some((item) => item.premiumCodes.some((entry) => normalizePremiumCode(entry.code) === normalizePremiumCode(codeForMutation)))) return json({ error: "duplicate_code" }, 409);
      const code: PremiumCode = current ? { ...current, active } : {
        id: crypto.randomUUID(), productId, code: codeForMutation, active, codeType: "shared",
      };
      saveContentSnapshot({ ...snapshot, products: snapshot.products.map((item) => item.id === productId ? { ...item, premiumCodes: [...item.premiumCodes.filter((entry) => entry.id !== current?.id), code] } : item) });
      return json({ ok: true, code }, 200);
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("manage_shared_premium_code", { requested_product_id: productId, requested_code: codeForMutation, requested_active: active });
    if (error?.code === "23505") return json({ error: "duplicate_code" }, 409);
    if (error?.code === "23514" || error?.code === "22023") return json({ error: "invalid_code" }, 400);
    if (error) throw new Error("Shared code mutation failed.");
    if (!data) return json({ error: "not_found" }, 404);
    return json({ ok: true, code: { id: data.id, productId: data.product_id, code: data.code, active: data.active, codeType: "shared" } }, 200);
  } catch { return json({ error: "unavailable" }, 503); }
}

async function getExistingSharedCode(productId: string) {
  try {
    const snapshot = getBackendMode() === "local" ? getContentSnapshot() : await getAdminContentSnapshot();
    return snapshot.products.find((item) => item.id === productId)?.premiumCodes.find((item) => item.codeType === "shared" && !item.retiredAt);
  } catch { return undefined; }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!await isAdmin()) return json({ error: "unauthorized" }, 401);
  if (!isTrustedOrigin(request)) return json({ error: "invalid_request" }, 403);
  const { productId } = await params;
  const codeId = new URL(request.url).searchParams.get("codeId");
  if (!codeId) return json({ error: "invalid_request" }, 400);

  try {
    if (getBackendMode() === "local") {
      const snapshot = getContentSnapshot();
      const product = snapshot.products.find((item) => item.id === productId);
      const code = product?.premiumCodes.find((item) => item.id === codeId && item.codeType === "shared" && !item.retiredAt);
      if (!product || !code) return json({ error: "code_not_found" }, 404);
      const retired = { ...code, active: false, retiredAt: new Date().toISOString() };
      saveContentSnapshot({ ...snapshot, products: snapshot.products.map((item) => item.id === productId
        ? { ...item, premiumCodes: item.premiumCodes.map((entry) => entry.id === codeId ? retired : entry) }
        : item) });
      return json({ ok: true }, 200);
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("retire_shared_premium_code", { requested_product_id: productId, requested_code_id: codeId });
    if (error?.code === "22P02") return json({ error: "invalid_request" }, 400);
    if (error) return json({ error: "unavailable" }, 503);
    return data ? json({ ok: true }, 200) : json({ error: "code_not_found" }, 404);
  } catch { return json({ error: "unavailable" }, 503); }
}

export async function GET(request: Request, { params }: Context) {
  if (!await isAdmin()) return json({ error: "unauthorized" }, 401);
  try {
    const { productId } = await params;
    const snapshot = await getAdminContentSnapshot();
    const product = snapshot.products.find((item) => item.id === productId);
    if (!product) return json({ error: "not_found" }, 404);
    const url = new URL(request.url);
    const codeId = url.searchParams.get("codeId");
    const code = product.premiumCodes.find((item) => !item.retiredAt && (codeId === null ? item.codeType === "shared" : item.id === codeId));
    const format = url.searchParams.get("format");
    if (!format) return json({ ok: true, code: code ?? null }, 200);
    if (format !== "svg" && format !== "pdf") return json({ error: "invalid_format" }, 400);
    if (codeId !== null && !code) return json({ error: "not_found" }, 404);
    if (!code || (codeId === null && (!code.active || product.status !== "published"))) return json({ error: "publish_and_activate_first" }, 409);
    const contents = format === "svg" ? renderSharedPremiumQrSvg(productId, code.code) : new Uint8Array(await renderSharedPremiumQrPdf(productId, code.code));
    return new NextResponse(contents, { headers: {
      ...privateHeaders,
      "Content-Type": format === "svg" ? "image/svg+xml; charset=utf-8" : "application/pdf",
      "Content-Disposition": `${url.searchParams.get("preview") === "1" ? "inline" : "attachment"}; filename="lamilialomi-kdp-${productId}${codeId ? `-${encodeURIComponent(code.id)}` : ""}.${format}"`,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    } });
  } catch { return json({ error: "unavailable" }, 503); }
}

async function isAdmin() {
  try { return hasAdminAccess(await getDemoSession()); } catch { return false; }
}

function isTrustedOrigin(request: Request) {
  try {
    const origin = request.headers.get("origin");
    return origin === getCanonicalAppUrl().origin || (getBackendMode() === "local" && origin === new URL(request.url).origin);
  } catch { return false; }
}

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}
