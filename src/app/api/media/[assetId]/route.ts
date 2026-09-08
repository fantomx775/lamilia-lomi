import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { getBackendMode } from "@/lib/config";
import { isMediaKind, mediaBucketForKind, mediaFilenameForDisplay } from "@/lib/media-upload";
import { getAssetByIdForRequest, getProductByIdForRequest } from "@/lib/products-request";
import { createServiceRoleClient } from "@/lib/supabase/admin";

type Props = { params: Promise<{ assetId: string }> };

export async function GET(request: Request, { params }: Props) {
  const { assetId } = await params;
  let asset: Awaited<ReturnType<typeof getAssetByIdForRequest>>;
  let product: Awaited<ReturnType<typeof getProductByIdForRequest>> | null = null;

  try {
    asset = await getAssetByIdForRequest(assetId);
    product = asset ? await getProductByIdForRequest(asset.productId) : null;
  } catch (error) {
    return unavailableMediaResponse(assetId, undefined, error);
  }

  if (!asset || !product || product.status !== "published" || asset.isPublic !== true || asset.isActive === false || asset.kind === "premium_download") {
    return notFoundMediaResponse();
  }

  if (getBackendMode() === "local") {
    const isDownload = new URL(request.url).searchParams.get("download") === "1";

    if (asset.path.startsWith("/assets/") && !isDownload) {
      return NextResponse.redirect(new URL(asset.path, request.url));
    }

    const relativePath = asset.path.startsWith("/assets/")
      ? asset.path.slice(1)
      : asset.path.startsWith("/uploads/")
        ? `uploads/${asset.path.slice("/uploads/".length)}`
        : null;

    if (!relativePath) {
      return notFoundMediaResponse();
    }

    const publicRoot = path.resolve(process.cwd(), "public");
    const filePath = path.resolve(publicRoot, ...relativePath.split("/").map((part) => decodeURIComponent(part)));
    if (!filePath.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(filePath)) {
      return notFoundMediaResponse();
    }

    const headers = new Headers({
      "Content-Type": asset.contentType,
      "Content-Length": String(fs.statSync(filePath).size),
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    if (isDownload) {
      headers.set("Content-Disposition", `attachment; filename="${safeFilename(asset.filename)}"`);
    }
    return new NextResponse(fs.readFileSync(filePath), { headers });
  }

  if (!isMediaKind(asset.kind) || asset.bucket !== mediaBucketForKind(asset.kind)) {
    return notFoundMediaResponse();
  }

  const storagePath = asset.storagePath;
  if (!storagePath || !storagePath.startsWith(`products/${asset.productId}/${asset.kind}/`)) {
    return notFoundMediaResponse();
  }

  const isDownload = new URL(request.url).searchParams.get("download") === "1";
  let signedUrlResult: {
    data: { signedUrl?: string } | null;
    error: unknown;
  };

  try {
    signedUrlResult = await createServiceRoleClient()
      .storage
      .from(asset.bucket)
      .createSignedUrl(storagePath, 60, { download: isDownload ? safeFilename(asset.filename) : undefined });
  } catch (error) {
    return unavailableMediaResponse(assetId, asset, error);
  }

  const { data, error } = signedUrlResult;

  if (error || !data?.signedUrl) {
    if (isMissingStorageObjectError(error)) {
      return notFoundMediaResponse();
    }

    return unavailableMediaResponse(assetId, asset, error);
  }

  let redirectTarget: URL;
  try {
    redirectTarget = new URL(data.signedUrl);
  } catch (error) {
    return unavailableMediaResponse(assetId, asset, error);
  }

  if (redirectTarget.protocol !== "https:") {
    return unavailableMediaResponse(assetId, asset, new Error("Unexpected signed URL protocol."));
  }

  const response = NextResponse.redirect(redirectTarget);
  response.headers.set("Cache-Control", "private, max-age=30");
  return response;
}

function safeFilename(value: string) {
  return mediaFilenameForDisplay(value).replace(/["\\]/g, "_").slice(0, 180) || "download";
}

function notFoundMediaResponse() {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

function unavailableMediaResponse(
  assetId: string,
  asset: { bucket: string; kind: string } | null | undefined,
  error: unknown,
) {
  console.error("[public-media] Signed media URL generation failed.", {
    assetId,
    bucket: asset?.bucket ?? null,
    kind: asset?.kind ?? null,
    status: storageErrorStatus(error),
    statusCode: storageErrorStatusCode(error),
  });
  return new NextResponse("Media temporarily unavailable", {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

function isMissingStorageObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const status = storageErrorStatus(error);
  if (status === 404) return true;

  const statusCode = storageErrorStatusCode(error)?.toLowerCase();
  if (statusCode === "nosuchkey" || statusCode === "not_found" || statusCode === "404") {
    return true;
  }

  const message = "message" in error && typeof error.message === "string"
    ? error.message
    : "";
  return /object not found|no such key/i.test(message);
}

function storageErrorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return undefined;
  }

  const value = error.status;
  const status = typeof value === "number" ? value : Number(value);
  return Number.isFinite(status) ? status : undefined;
}

function storageErrorStatusCode(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return undefined;
  }

  const value = error.statusCode;
  return value === undefined || value === null ? undefined : String(value);
}
