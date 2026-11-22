import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { hasAdminAccess } from "@/lib/auth";
import { getBackendMode } from "@/lib/config";
import { getPublicR2ImageAssetByIdForRequest } from "@/lib/content-repository";
import { defaultLocale } from "@/lib/locale";
import { isMediaKind, mediaBucketForKind, mediaFilenameForDisplay } from "@/lib/media-upload";
import { getR2PublicBaseUrl, r2PublicMediaUrl } from "@/lib/media-r2-config";
import { createSignedR2ReadUrl } from "@/lib/media-r2";
import { hasProductImageCachePurge, versionedProductImagePath } from "@/lib/product-image-cache";
import { versionedPublicImageResponse } from "@/lib/versioned-public-image-response";
import { getAssetByIdForRequest, getProductByIdForRequest } from "@/lib/products-request";
import { getDemoSession } from "@/lib/session.server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

type Props = { params: Promise<{ assetId: string }> };

export async function GET(request: Request, { params }: Props) {
  const { assetId } = await params;
  const requestUrl = new URL(request.url);
  const requestedVersion = requestUrl.searchParams.get("v");
  if (
    requestedVersion !== null &&
    (requestedVersion !== assetId || (getBackendMode() !== "local" && !isUuid(requestedVersion)))
  ) {
    return notFoundMediaResponse();
  }

  let asset: Awaited<ReturnType<typeof getAssetByIdForRequest>>;
  let product: { id: string; status: string } | null | undefined = null;
  let adminPreviewAuthorized = false;

  try {
    if (requestedVersion !== null && getBackendMode() !== "local") {
      asset = await getPublicR2ImageAssetByIdForRequest(assetId);
      product = asset ? { id: asset.productId, status: "published" } : null;
      if (!asset) return notFoundMediaResponse();
    } else {
      asset = await getAssetByIdForRequest(assetId);
      product = asset ? await getProductByIdForRequest(asset.productId) : null;
    }

    if (requestedVersion === null && (!asset || !product || product.status !== "published")) {
      if (!hasAdminAccess(await getDemoSession())) {
        return notFoundMediaResponse();
      }

      adminPreviewAuthorized = true;
      asset = await getAssetByIdForRequest(assetId, { includeDrafts: true });
      product = asset
        ? await getProductByIdForRequest(asset.productId, { includeDrafts: true })
        : null;
    }

    if (asset?.locale != null && asset.locale !== defaultLocale && !adminPreviewAuthorized) {
      adminPreviewAuthorized = hasAdminAccess(await getDemoSession());
      if (!adminPreviewAuthorized) {
        return notFoundMediaResponse();
      }
    }
  } catch (error) {
    return unavailableMediaResponse(assetId, undefined, error);
  }

  if (
    !asset ||
    !product ||
    (product.status !== "published" && !adminPreviewAuthorized) ||
    (asset.locale != null && asset.locale !== defaultLocale && !adminPreviewAuthorized) ||
    asset.isPublic !== true ||
    asset.isActive === false ||
    asset.kind === "premium_download"
  ) {
    return notFoundMediaResponse();
  }

  if (getBackendMode() === "local") {
    const isDownload = new URL(request.url).searchParams.get("download") === "1";

    if (asset.path.startsWith("/assets/") && !isDownload && requestedVersion === null) {
      return NextResponse.redirect(new URL(asset.path, request.url));
    }

    const localUploadPath = asset.path.startsWith("/uploads/")
      ? asset.path
      : asset.path === `/api/media/${assetId}` && asset.storagePath?.startsWith("/uploads/")
        ? asset.storagePath
        : null;
    const relativePath = asset.path.startsWith("/assets/")
      ? asset.path.slice(1)
      : localUploadPath
        ? localUploadRelativePath(localUploadPath, asset.productId, asset.kind)
        : null;

    if (!relativePath) {
      return notFoundMediaResponse();
    }

    const publicRoot = path.resolve(process.cwd(), "public");
    const isLocalUpload = localUploadPath !== null;
    let filePath: string;
    try {
      const segments = relativePath.split("/");
      filePath = path.resolve(publicRoot, ...(isLocalUpload ? segments : segments.map((part) => decodeURIComponent(part))));
    } catch {
      return notFoundMediaResponse();
    }
    const expectedUploadDirectory = isLocalUpload
      ? path.resolve(publicRoot, "uploads", asset.productId, asset.kind)
      : null;
    if (
      !isPathInsideDirectory(publicRoot, filePath) ||
      (expectedUploadDirectory && !isPathInsideDirectory(expectedUploadDirectory, filePath))
    ) {
      return notFoundMediaResponse();
    }

    let fileSize: number;
    try {
      fileSize = fs.statSync(filePath).size;
    } catch {
      return notFoundMediaResponse();
    }
    const range = parseByteRange(request.headers.get("range"), fileSize);
    if (range.kind === "unsatisfiable") {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${fileSize}`,
          "Cache-Control": "no-store",
        },
      });
    }

    const contentLength = range.kind === "range" ? range.end - range.start + 1 : fileSize;
    const headers = new Headers({
      "Content-Type": asset.contentType,
      "Content-Length": String(contentLength),
      "Accept-Ranges": "bytes",
      "Cache-Control": requestedVersion === null
        ? "public, max-age=31536000, immutable"
        : "public, max-age=60, s-maxage=60",
    });
    if (range.kind === "range") {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${fileSize}`);
    }
    if (isDownload) {
      headers.set("Content-Disposition", `attachment; filename="${safeFilename(asset.filename)}"`);
    }
    const fileStream = fs.createReadStream(
      filePath,
      range.kind === "range" ? { start: range.start, end: range.end } : undefined,
    );
    const body = Readable.toWeb(fileStream) as unknown as BodyInit;
    return new NextResponse(body, {
      status: range.kind === "range" ? 206 : 200,
      headers,
    });
  }

  if (!isMediaKind(asset.kind) || asset.bucket !== mediaBucketForKind(asset.kind)) {
    return notFoundMediaResponse();
  }

  const storagePath = asset.storagePath;
  if (!storagePath || !storagePath.startsWith(`products/${asset.productId}/${asset.kind}/`)) {
    return notFoundMediaResponse();
  }

  const isDownload = new URL(request.url).searchParams.get("download") === "1";
  if (asset.storageProvider === "r2_public" && product.status === "published") {
    const publicUrl = r2PublicMediaUrl(getR2PublicBaseUrl() ?? "", storagePath);
    if (publicUrl) {
      if (requestedVersion !== null && !isDownload) {
        try {
          const extendedCache = hasProductImageCachePurge();
          const canonicalSource = `${requestUrl.pathname}${requestUrl.search}` === versionedProductImagePath(assetId);
          const imageResponse = await versionedPublicImageResponse(request, publicUrl);
          if (imageResponse && extendedCache && canonicalSource && !adminPreviewAuthorized) {
            imageResponse.headers.set("Cache-Control", "public, max-age=60, s-maxage=604800");
            // Keep the source route out of shared caches so a purged transform
            // must recheck publication before it can fetch the original again.
            imageResponse.headers.set("Vercel-CDN-Cache-Control", "no-store");
          }
          return imageResponse ?? notFoundMediaResponse();
        } catch (error) {
          return unavailableMediaResponse(assetId, asset, error);
        }
      }

      const response = NextResponse.redirect(publicUrl);
      response.headers.set(
        "Cache-Control",
        adminPreviewAuthorized ? "private, no-store" : "private, max-age=30",
      );
      return response;
    }
  }

  if (
    asset.storageProvider === "r2_private" ||
    asset.storageProvider === "r2_public_pending" ||
    asset.storageProvider === "r2_public_revoking" ||
    asset.storageProvider === "r2_public"
  ) {
    try {
      const signedUrl = await createSignedR2ReadUrl(storagePath);
      const response = NextResponse.redirect(signedUrl);
      response.headers.set(
        "Cache-Control",
        adminPreviewAuthorized ? "private, no-store" : "private, max-age=30",
      );
      return response;
    } catch (r2Error) {
      console.error("[public-media] R2 read failed; trying the retained Supabase mirror.", {
        assetId,
        status: storageErrorStatus(r2Error),
        statusCode: storageErrorStatusCode(r2Error),
      });
    }
  }

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
  response.headers.set(
    "Cache-Control",
    adminPreviewAuthorized ? "private, no-store" : "private, max-age=30",
  );
  return response;
}

function parseByteRange(value: string | null, size: number):
  | { kind: "full" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" } {
  if (!value) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return { kind: "full" };

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size === 0) {
      return { kind: "unsatisfiable" };
    }
    return { kind: "range", start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || start > requestedEnd) {
    return { kind: "unsatisfiable" };
  }
  return { kind: "range", start, end: Math.min(requestedEnd, size - 1) };
}

function localUploadRelativePath(value: string, productId: string, kind: string) {
  if (!value.startsWith("/uploads/")) return null;
  let segments: string[];
  try {
    segments = value.slice("/uploads/".length).split("/").map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (
    segments.length !== 3 ||
    segments[0] !== productId ||
    segments[1] !== kind ||
    segments[0].includes("/") ||
    segments[0].includes("\\") ||
    segments[1].includes("/") ||
    segments[1].includes("\\") ||
    !segments[2] ||
    segments[2] === "." ||
    segments[2] === ".." ||
    segments[2].includes("/") ||
    segments[2].includes("\\")
  ) {
    return null;
  }
  return path.join("uploads", ...segments);
}

function isPathInsideDirectory(directory: string, candidate: string) {
  const relative = path.relative(directory, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safeFilename(value: string) {
  return mediaFilenameForDisplay(value).replace(/["\\]/g, "_").slice(0, 180) || "download";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
