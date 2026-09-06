import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { getBackendMode } from "@/lib/config";
import { getAssetByIdForRequest, getProductByIdForRequest } from "@/lib/products-request";
import { createServiceRoleClient } from "@/lib/supabase/admin";

type Props = { params: Promise<{ assetId: string }> };

export async function GET(request: Request, { params }: Props) {
  const { assetId } = await params;
  const asset = await getAssetByIdForRequest(assetId);
  const product = asset ? await getProductByIdForRequest(asset.productId) : null;

  if (!asset || !product || product.status !== "published" || asset.isPublic !== true || asset.isActive === false || asset.kind === "premium_download") {
    return new NextResponse("Not found", { status: 404 });
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
      return new NextResponse("Not found", { status: 404 });
    }

    const publicRoot = path.resolve(process.cwd(), "public");
    const filePath = path.resolve(publicRoot, ...relativePath.split("/").map((part) => decodeURIComponent(part)));
    if (!filePath.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(filePath)) {
      return new NextResponse("Not found", { status: 404 });
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

  const storagePath = asset.storagePath;
  if (!storagePath || !storagePath.startsWith(`products/${asset.productId}/`)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { data, error } = await createServiceRoleClient().storage.from(asset.bucket).download(storagePath);
  if (error || !data) {
    return new NextResponse("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": asset.contentType,
    "Content-Length": String(asset.sizeBytes ?? data.size),
    "Cache-Control": "public, max-age=31536000, immutable",
  });

  if (new URL(request.url).searchParams.get("download") === "1") {
    headers.set("Content-Disposition", `attachment; filename="${safeFilename(asset.filename)}"`);
  }

  return new NextResponse(data, { headers });
}

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "download";
}
