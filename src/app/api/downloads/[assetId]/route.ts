import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { buildBusinessEventPayload } from "@/lib/analytics";
import { normalizeLocale } from "@/lib/locale";
import { getAssetById } from "@/lib/products";
import { canDownloadPremiumAsset } from "@/lib/premium";
import { sanitizeReturnTo } from "@/lib/return-to";
import { getDemoSession } from "@/lib/session.server";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  const session = await getDemoSession();
  const url = new URL(request.url);
  const locale = normalizeLocale(url.searchParams.get("locale") ?? undefined);
  const returnTo = sanitizeReturnTo(
    url.searchParams.get("returnTo"),
    locale,
    `/${locale}/library`,
  );

  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        reason: "guest",
        next: `/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`,
        message: "Sign in to download this file.",
      },
      { status: 401 },
    );
  }

  const asset = getAssetById(assetId);

  if (!asset) {
    return NextResponse.json(
      { ok: false, reason: "unavailable", message: "This download is not available." },
      { status: 404 },
    );
  }

  const decision = canDownloadPremiumAsset({ asset, session });

  if (!decision.allowed) {
    return NextResponse.json(
      {
        ok: false,
        reason: decision.reason,
        message:
          decision.reason === "locked"
            ? "Unlock this product before downloading its premium file."
            : decision.reason === "unverified"
              ? "Verify your email before downloading premium files."
              : "This download is not available.",
      },
      { status: decision.reason === "wrong_asset" ? 404 : 403 },
    );
  }

  const filePath = getPrivateDemoAssetPath(asset.demoPrivatePath);

  if (!filePath) {
    return NextResponse.json(
      { ok: false, reason: "backend_contract_missing", message: "This download is not available." },
      { status: 503 },
    );
  }

  let file: Buffer;

  try {
    file = await readFile(filePath);
  } catch {
    return NextResponse.json(
      { ok: false, reason: "unavailable", message: "This download is not available." },
      { status: 404 },
    );
  }

  const response = new NextResponse(new Uint8Array(file), {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(file.byteLength),
      "Content-Disposition": `attachment; filename="${safeFilename(asset.filename)}"`,
      "Cache-Control": "private, no-store",
    },
  });

  response.headers.set(
    "x-lamilialomi-event",
    JSON.stringify(
      buildBusinessEventPayload("premium_file_download", {
        assetId: asset.id,
        productId: asset.productId,
      }),
    ),
  );

  return response;
}

function getPrivateDemoAssetPath(filename: string | undefined) {
  if (!filename) {
    return null;
  }

  const root = path.resolve(process.cwd(), "private", "demo-premium");
  const candidate = path.resolve(root, path.basename(filename));

  return candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

function safeFilename(filename: string) {
  return path.basename(filename).replace(/["\\\r\n]/g, "_");
}
