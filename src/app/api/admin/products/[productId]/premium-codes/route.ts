import { NextResponse } from "next/server";

import { hasAdminAccess } from "@/lib/auth";
import { getBackendMode } from "@/lib/config";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { getContentSnapshot, saveContentSnapshot } from "@/lib/content-store";
import {
  createPremiumCodeBatch,
  exportPremiumCodesToCsv,
} from "@/lib/premium-code-batches";
import { getDemoSession } from "@/lib/session.server";
import { createClient } from "@/lib/supabase/server";
import { MAX_PREMIUM_CODE_BATCH_SIZE } from "@/lib/premium-code";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ productId: string }> };

export async function POST(request: Request, { params }: Context) {
  const session = await getAdminSession();
  if (!session) return json({ ok: false, error: "unauthorized" }, 401);
  if (!isSameOriginRequest(request)) return json({ ok: false, error: "invalid_request" }, 403);

  const { productId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const count = body && typeof body === "object" ? (body as Record<string, unknown>).count : undefined;
  if (!Number.isSafeInteger(count) || Number(count) < 1 || Number(count) > MAX_PREMIUM_CODE_BATCH_SIZE) {
    return json({ ok: false, error: "invalid_count" }, 400);
  }

  try {
    const codes = getBackendMode() === "local"
      ? await createLocalBatch(productId, Number(count))
      : await createSupabaseBatch(productId, Number(count));

    if (!codes) return json({ ok: false, error: "not_found" }, 404);
    return json({ ok: true, codes }, 201);
  } catch {
    return json({ ok: false, error: "unavailable" }, 503);
  }
}

export async function GET(_request: Request, { params }: Context) {
  const session = await getAdminSession();
  if (!session) return json({ ok: false, error: "unauthorized" }, 401);

  try {
    const { productId } = await params;
    const snapshot = await getAdminContentSnapshot();
    const product = snapshot.products.find((candidate) => candidate.id === productId);
    if (!product) return json({ ok: false, error: "not_found" }, 404);

    const csv = exportPremiumCodesToCsv(product);
    const filenameSlug = product.slug.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-") || "product";
    return new NextResponse(csv, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="lamilialomi-premium-codes-${filenameSlug}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return json({ ok: false, error: "unavailable" }, 503);
  }
}

async function createLocalBatch(productId: string, count: number) {
  const snapshot = getContentSnapshot();
  const product = snapshot.products.find((candidate) => candidate.id === productId);
  if (!product) return null;

  const existingCodes = snapshot.products.flatMap((candidate) =>
    candidate.premiumCodes.map((premiumCode) => premiumCode.code),
  );
  const codes = createPremiumCodeBatch({ productId, count, existingCodes });
  saveContentSnapshot({
    ...snapshot,
    products: snapshot.products.map((candidate) => candidate.id === productId
      ? { ...candidate, premiumCodes: [...candidate.premiumCodes, ...codes] }
      : candidate),
  });
  return codes;
}

async function createSupabaseBatch(productId: string, count: number) {
  const supabase = await createClient();
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .maybeSingle();

  if (productError) throw new Error("Premium code product lookup failed.");
  if (!product) return null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const codes = createPremiumCodeBatch({ productId, count });
    const { error } = await supabase.from("premium_codes").insert(
      codes.map((code) => ({
        id: code.id,
        product_id: code.productId,
        code: code.code,
        active: code.active,
      })),
    );

    if (!error) return codes;
    if (error.code !== "23505") throw new Error("Premium code batch insert failed.");
  }

  throw new Error("Could not insert a unique premium code batch.");
}

async function getAdminSession() {
  try {
    const session = await getDemoSession();
    return hasAdminAccess(session) ? session : null;
  } catch {
    return null;
  }
}

function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
