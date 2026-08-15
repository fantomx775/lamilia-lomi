import { NextResponse } from "next/server";

import { buildBusinessEventPayload } from "@/lib/analytics";
import { getAssetByIdForRequest } from "@/lib/products-request";
import { authorizePremiumDownloadForRequest } from "@/lib/premium-request";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  const asset = await getAssetByIdForRequest(assetId);
  const signedUrl = await authorizePremiumDownloadForRequest(assetId);

  if (!signedUrl.ok) {
    return NextResponse.json(
      { ok: false, reason: signedUrl.decision.reason },
      {
        status:
          signedUrl.decision.reason === "guest"
            ? 401
            : signedUrl.decision.reason === "wrong_asset"
              ? 404
              : 403,
      },
    );
  }

  const redirectTarget = new URL(signedUrl.url, request.url);
  const response = NextResponse.redirect(redirectTarget);

  if (asset) {
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

  return response;
}
