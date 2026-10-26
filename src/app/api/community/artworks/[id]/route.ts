import { NextResponse } from "next/server";

import { getCommunityFlags } from "@/lib/community-flags";
import {
  bodyErrorResponse,
  communityErrorResponse,
  communityJson,
  isSameOriginCommunityRequest,
  readBoundedJson,
} from "@/lib/community/http";
import { deleteMyCommunityArtwork, editMyCommunityArtworkDescription, getMyCommunityArtwork } from "@/lib/community/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isSameOriginCommunityRequest(request)) return communityJson({ ok: false, error: "invalid_request", message: "Refresh the page and try again." }, 403);
  if (!getCommunityFlags().uploadsEnabled) return disabledResponse();
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return communityJson({ ok: false, error: "invalid_body", message: "Send a valid edit request." }, 400);
  }
  const body = await readBoundedJson(request);
  if (!body.ok) return bodyErrorResponse(body.reason);
  if (!isEditBody(body.value)) return communityJson({ ok: false, error: "invalid_input", message: "Send a description and current revision." }, 400);
  try {
    const { id } = await params;
    await editMyCommunityArtworkDescription(id, body.value.revision, body.value.description);
    const artwork = await getMyCommunityArtwork(id);
    if (!artwork) return communityJson({ ok: false, error: "not_found", message: "This artwork is no longer available." }, 404);
    return communityJson({ ok: true, artwork });
  } catch (error) {
    return communityErrorResponse(error, "This artwork changed or is unavailable. Refresh and try again.");
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  if (!isSameOriginCommunityRequest(request)) return communityJson({ ok: false, error: "invalid_request", message: "Refresh the page and try again." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return communityJson({ ok: false, error: "invalid_body", message: "Send a valid delete request." }, 400);
  }
  const body = await readBoundedJson(request);
  if (!body.ok) return bodyErrorResponse(body.reason);
  if (!isRevisionBody(body.value)) return communityJson({ ok: false, error: "invalid_input", message: "Send the current artwork revision." }, 400);
  try {
    const { id } = await params;
    await deleteMyCommunityArtwork(id, body.value.revision);
    return communityJson({ ok: true, deleted: true });
  } catch (error) {
    return communityErrorResponse(error, "This artwork changed or is unavailable. Refresh and try again.");
  }
}

function isRevisionBody(value: unknown): value is { revision: number } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 1 && Number.isSafeInteger((value as Record<string, unknown>).revision)
    && Number((value as Record<string, unknown>).revision) > 0);
}

function isEditBody(value: unknown): value is { revision: number; description: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 2
    && Number.isSafeInteger(body.revision) && Number(body.revision) > 0
    && typeof body.description === "string" && body.description.length <= 1_000;
}

function disabledResponse() {
  return NextResponse.json({ ok: false, error: "unavailable", message: "Artwork edits are currently unavailable." }, {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
