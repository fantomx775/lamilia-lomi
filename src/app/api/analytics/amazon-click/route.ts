import { NextResponse } from "next/server";

import { buildBusinessEventPayload } from "@/lib/analytics";

export async function POST(request: Request) {
  let payload: Record<string, unknown> = {};

  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  return NextResponse.json({
    ok: true,
    event: buildBusinessEventPayload("amazon_link_click", {
      productId: typeof payload.productId === "string" ? payload.productId : undefined,
      market: typeof payload.market === "string" ? payload.market : undefined,
    }),
  });
}
