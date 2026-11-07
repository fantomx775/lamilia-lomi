import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { buildBusinessEventPayload } from "@/lib/analytics";
import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import { normalizeLocale } from "@/lib/locale";
import { getAssetByIdForRequest } from "@/lib/products-request";
import { authorizePremiumDownloadForRequest } from "@/lib/premium-request";
import { sanitizeReturnTo } from "@/lib/return-to";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  const requestUrl = new URL(request.url);
  let asset;
  try {
    asset = await getAssetByIdForRequest(assetId);
  } catch (error) {
    logUnexpectedFailure("[premium-download] Asset lookup failed unexpectedly.", error);
    return premiumErrorResponse(
      { ok: false, reason: "unavailable" },
      503,
    );
  }
  const token = requestUrl.searchParams.get("token");
  const expires = requestUrl.searchParams.get("expires");
  let signedUrl;
  try {
    signedUrl = await authorizePremiumDownloadForRequest(assetId, {
      ...(token !== null ? { token } : {}),
      ...(expires !== null ? { expires } : {}),
    });
  } catch (error) {
    logUnexpectedFailure("[premium-download] Authorization failed unexpectedly.", error);
    return premiumErrorResponse(
      { ok: false, reason: "unavailable" },
      503,
    );
  }

  if (!signedUrl.ok) {
    const next =
      signedUrl.decision.reason === "guest"
        ? getLoginTarget(request)
        : undefined;

    if (next && request.headers.get("accept")?.includes("text/html")) {
      const response = NextResponse.redirect(new URL(next, getCanonicalAppUrl()));
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    return premiumErrorResponse(
      { ok: false, reason: signedUrl.decision.reason, ...(next ? { next } : {}) },
      signedUrl.decision.reason === "guest"
        ? 401
        : signedUrl.decision.reason === "wrong_asset"
          ? 404
          : 403,
    );
  }

  if (!asset) {
    return premiumErrorResponse(
      { ok: false, reason: "unavailable" },
      404,
    );
  }

  if (getBackendMode() === "local") {
    const filePath = getPrivateDemoAssetPath(asset.demoPrivatePath);

    if (!filePath) {
      return premiumErrorResponse(
        { ok: false, reason: "backend_contract_missing" },
        503,
      );
    }

    let file: Buffer;

    try {
      file = await readFile(/* turbopackIgnore: true */ filePath);
    } catch {
      return premiumErrorResponse(
        { ok: false, reason: "unavailable" },
        404,
      );
    }

    const response = new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(file.byteLength),
        "Content-Disposition": contentDisposition(asset.filename),
        "Cache-Control": "private, no-store",
      },
    });

    setDownloadEvent(response, asset);
    return response;
  }

  if (!("url" in signedUrl) || typeof signedUrl.url !== "string") {
    return premiumErrorResponse(
      { ok: false, reason: "backend_contract_missing" },
      503,
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(signedUrl.url, { cache: "no-store", redirect: "error", signal: request.signal });
  } catch {
    console.error("[premium-download] Private storage streaming failed.");
    return premiumErrorResponse({ ok: false, reason: "unavailable" }, 503);
  }

  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => undefined);
    return premiumErrorResponse({ ok: false, reason: "unavailable" }, 502);
  }

  const headers = new Headers({
    "Content-Type": asset.contentType,
    "Content-Disposition": contentDisposition(asset.filename),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const contentLength = upstream.headers.get("content-length");
  // Fetch decompresses upstream bodies before exposing the stream.
  if (contentLength && /^\d+$/.test(contentLength) && !upstream.headers.has("content-encoding")) {
    headers.set("Content-Length", contentLength);
  }

  const response = new NextResponse(upstream.body, { status: 200, headers });
  setDownloadEvent(response, asset);
  return response;
}

function getLoginTarget(request: Request) {
  const requestUrl = new URL(request.url);
  const locale = normalizeLocale(requestUrl.searchParams.get("locale") ?? undefined);
  const returnTo = sanitizeReturnTo(
    requestUrl.searchParams.get("returnTo"),
    locale,
    `/${locale}/library`,
  );

  return `/${locale}/login?returnTo=${encodeURIComponent(returnTo)}`;
}

function premiumErrorResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function getPrivateDemoAssetPath(filename: string | undefined) {
  if (!filename) {
    return null;
  }

  const root = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "private",
    "demo-premium",
  );
  const candidate = path.resolve(root, path.basename(filename));

  return candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

function safeFilename(filename: string) {
  return path.basename(filename).replace(/["\\\r\n]/g, "_");
}

function contentDisposition(filename: string) {
  const safe = safeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function setDownloadEvent(
  response: NextResponse,
  asset: { id: string; productId: string },
) {
  response.headers.set(
    "x-lamilialomi-event",
    JSON.stringify(
      buildBusinessEventPayload("premium_file_download", {
        assetId: asset.id,
        productId: asset.productId,
      }),
    ),
  );
}

function logUnexpectedFailure(message: string, error: unknown) {
  console.error(message, {
    type: error instanceof Error ? error.name : typeof error,
  });
}
