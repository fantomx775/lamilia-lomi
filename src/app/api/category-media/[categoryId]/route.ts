import { NextResponse } from "next/server";

import { getBackendMode } from "@/lib/config";
import { getPublicContentSnapshot } from "@/lib/content-repository";
import { getR2PublicBaseUrl, isSafeCategoryImageStoragePath, r2PublicMediaUrl } from "@/lib/media-r2-config";
import { createServiceRoleClient } from "@/lib/supabase/admin";

type Props = { params: Promise<{ categoryId: string }> };

export async function GET(request: Request, { params }: Props) {
  const { categoryId } = await params;
  if (!isUuid(categoryId)) return notFound();

  const requestedImageId = new URL(request.url).searchParams.get("v");
  if (requestedImageId && !isUuid(requestedImageId)) return notFound();

  if (getBackendMode() === "local") {
    const category = (await getPublicContentSnapshot()).categories.find((entry) => entry.id === categoryId);
    if (!category?.image || (requestedImageId && requestedImageId !== category.image.id)) return notFound();
    const response = NextResponse.redirect(new URL(category.image.path, request.url));
    response.headers.set("Cache-Control", "private, max-age=30");
    return response;
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("categories")
    .select("image_asset_id,image_storage_path,image_storage_provider")
    .eq("id", categoryId)
    .maybeSingle();

  if (error) {
    console.error("[category-media] Nie udało się odczytać obrazu kategorii.", { categoryId, code: error.code });
    return NextResponse.json({ error: "Media chwilowo niedostępne." }, { status: 503 });
  }

  const imageId = typeof data?.image_asset_id === "string" ? data.image_asset_id : "";
  const storagePath = typeof data?.image_storage_path === "string" ? data.image_storage_path : "";
  const provider = data?.image_storage_provider;
  if (
    !isUuid(imageId) ||
    (requestedImageId && requestedImageId !== imageId) ||
    !isSafeCategoryImageStoragePath(storagePath, categoryId, imageId) ||
    (provider !== "supabase" && provider !== "r2_public")
  ) {
    return notFound();
  }

  if (provider === "r2_public") {
    const publicUrl = r2PublicMediaUrl(getR2PublicBaseUrl() ?? "", storagePath);
    return publicUrl ? redirect(publicUrl) : notFound();
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from("public-media")
    .createSignedUrl(storagePath, 60);
  if (signedError || !signedData?.signedUrl) {
    console.error("[category-media] Nie udało się podpisać obrazu kategorii.", { categoryId, imageId });
    return notFound();
  }

  let signedUrl: URL;
  try {
    signedUrl = new URL(signedData.signedUrl);
  } catch {
    return notFound();
  }
  if (signedUrl.protocol !== "https:") return notFound();
  return redirect(signedUrl.toString());
}

function redirect(destination: string) {
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "private, max-age=30");
  return response;
}

function notFound() {
  return NextResponse.json({ error: "Nie znaleziono obrazu kategorii." }, { status: 404 });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
