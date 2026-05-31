import { NextResponse } from "next/server";

import { buildBusinessEventPayload } from "@/lib/analytics";
import { getAssetById } from "@/lib/products";
import { createSignedDownloadUrl } from "@/lib/premium";
import { getDemoSession } from "@/lib/session.server";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  const asset = getAssetById(assetId);
  const session = await getDemoSession();

  if (!asset) {
    return NextResponse.json({ ok: false, error: "Asset not found" }, { status: 404 });
  }

  if (!session) {
    return NextResponse.json({ ok: false, reason: "guest" }, { status: 401 });
  }

  const signedUrl = createSignedDownloadUrl({ asset, session });

  if (!signedUrl.ok) {
    return NextResponse.json(
      { ok: false, reason: signedUrl.decision.reason },
      { status: signedUrl.decision.reason === "unverified" ? 403 : 401 },
    );
  }

  const redirectTarget = new URL(signedUrl.url, request.url);
  const response = NextResponse.redirect(redirectTarget);

  response.headers.set("x-lamilialomi-event", JSON.stringify(buildBusinessEventPayload("premium_file_download", {
    assetId: asset.id,
    productId: asset.productId,
  })));

  return response;
}
