import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getBackendMode } from "@/lib/config";
import { getCommunityFlags } from "@/lib/community-flags";
import {
  communityErrorResponse,
  communityJson,
  isSameOriginCommunityRequest,
  readBoundedBinaryBody,
} from "@/lib/community/http";
import { normalizeCommunityArtworkImage, communityUploadFingerprint, COMMUNITY_IMAGE_MAX_BYTES } from "@/lib/community/image";
import {
  assertCommunityArtworkUploadEligibility,
  consumeCommunityRateLimit,
  finalizeCommunityArtworkUpload,
  getCommunityUploadReservation,
  getMyCommunityArtwork,
  markCommunityArtworkUploadStored,
  processCommunityArtworkCleanup,
  reserveCommunityArtworkUpload,
  scheduleCommunityArtworkUploadCleanup,
} from "@/lib/community/repository";
import { getCommunityActorForRequest } from "@/lib/community/session";
import { storeCommunityArtworkImage, readCommunityArtworkImage } from "@/lib/community/storage";
import { CommunityAuthorizationError, CommunityConflictError, CommunityRateLimitError, CommunityValidationError } from "@/lib/community/errors";
import { getMediaUploadProvider } from "@/lib/media-r2-config";
import { listCommunityPublicArtworks } from "@/lib/community/repository";
import { decodeCommunityPopularCursor, decodeCommunityTimestampCursor } from "@/lib/community/cursor";
import type { CommunityAudience } from "@/lib/community/types";
import { getCommunityHeartContext } from "@/lib/community/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const MAX_MULTIPART_BYTES = COMMUNITY_IMAGE_MAX_BYTES + 64 * 1024;
const ALLOWED_FIELDS = new Set(["file", "productId", "description", "idempotencyKey", "rulesAccepted"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  if (!getCommunityFlags().publicEnabled) return disabledResponse();
  const url = new URL(request.url);
  const allowed = new Set(["audience", "productId", "sort", "cursor", "limit"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))
    || [...allowed].some((key) => url.searchParams.getAll(key).length > 1)) {
    return communityJson({ ok: false, error: "invalid_input", message: "Check the gallery filters." }, 400);
  }
  const audienceValue = url.searchParams.get("audience");
  const productId = url.searchParams.get("productId");
  const sort = url.searchParams.get("sort") ?? "latest";
  const cursor = url.searchParams.get("cursor");
  const limitValue = url.searchParams.get("limit");
  const limit = limitValue === null ? 24 : /^\d{1,2}$/.test(limitValue) ? Number(limitValue) : Number.NaN;
  if ((audienceValue !== null && audienceValue !== "kids" && audienceValue !== "adults")
    || (productId !== null && !UUID_PATTERN.test(productId))
    || (sort !== "latest" && sort !== "popular")
    || (cursor !== null && !(sort === "popular" ? decodeCommunityPopularCursor(cursor) : decodeCommunityTimestampCursor(cursor)))
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 48) {
    return communityJson({ ok: false, error: "invalid_input", message: "Check the gallery filters." }, 400);
  }
  try {
    const context = await getCommunityHeartContext();
    const page = await listCommunityPublicArtworks({
      audience: (audienceValue ?? undefined) as CommunityAudience | undefined,
      productId: productId?.toLowerCase(),
      sort,
      cursor,
      limit,
      viewer: context.access === "member" ? context.actor : undefined,
    });
    return communityJson({ ok: true, ...page, heartAccess: context.access });
  } catch {
    return communityJson({ ok: false, error: "unavailable", message: "The Coloring Club gallery could not be loaded." }, 503);
  }
}

export async function POST(request: Request) {
  if (!getCommunityFlags().uploadsEnabled) return disabledResponse();
  if (!isSameOriginCommunityRequest(request)) return communityJson({ ok: false, error: "forbidden", message: "This request could not be verified." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return communityJson({ ok: false, error: "invalid_input", message: "Choose an image to upload." }, 415);
  }
  let actor;
  try {
    actor = await getCommunityActorForRequest();
  } catch {
    return communityJson({ ok: false, error: "unavailable", message: "Your account could not be checked." }, 503);
  }
  if (!actor) return communityJson({ ok: false, error: "unauthorized", message: "Log in to share your artwork." }, 401);
  if (!actor.emailVerified) return communityJson({ ok: false, error: "email_unverified", message: "Verify your email before sharing artwork." }, 403);

  const bounded = await readBoundedBinaryBody(request, MAX_MULTIPART_BYTES);
  if (!bounded.ok) return communityJson({ ok: false, error: bounded.reason === "too_large" ? "body_too_large" : "invalid_body", message: bounded.reason === "too_large" ? "The image request is too large." : "Send a valid image upload." }, bounded.reason === "too_large" ? 413 : 400);

  let form: FormData;
  try {
    form = await new Response(Uint8Array.from(bounded.bytes), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
  } catch {
    return communityJson({ ok: false, error: "invalid_body", message: "Send a valid image upload." }, 400);
  }
  const fields = [...form.keys()];
  if (fields.some((field) => !ALLOWED_FIELDS.has(field)) || new Set(fields).size !== fields.length
    || form.getAll("file").length !== 1) {
    return communityJson({ ok: false, error: "invalid_input", message: "Send one image and the requested artwork details." }, 400);
  }
  const file = form.get("file");
  const productId = form.get("productId");
  const description = form.get("description");
  const idempotencyKey = form.get("idempotencyKey");
  if (!(file instanceof File) || typeof productId !== "string" || !UUID_PATTERN.test(productId)
    || typeof idempotencyKey !== "string" || !UUID_PATTERN.test(idempotencyKey)
    || (description !== null && typeof description !== "string")
    || form.get("rulesAccepted") !== "true") {
    return communityJson({ ok: false, error: "invalid_input", message: "Check the book, description, and community rules confirmation." }, 400);
  }
  const safeDescription = typeof description === "string" ? description.trim() : "";
  const safeProductId = productId.toLowerCase();
  const safeIdempotencyKey = idempotencyKey.toLowerCase();
  if (Array.from(safeDescription).length > 240) {
    return communityJson({ ok: false, error: "invalid_input", message: "Description must be 240 characters or fewer." }, 400);
  }
  if (file.size <= 0 || file.size > COMMUNITY_IMAGE_MAX_BYTES) {
    return communityJson({ ok: false, error: "invalid_input", message: "Choose an image no larger than 4 MiB." }, 400);
  }

  try {
    await assertCommunityArtworkUploadEligibility(actor, safeProductId);
    if (!await consumeCommunityRateLimit("artwork-upload-attempt", actor.userId, 12, 60 * 60)) {
      throw new CommunityRateLimitError("You have tried to upload too often. Try again later.");
    }
    const originalBytes = new Uint8Array(await file.arrayBuffer());
    const image = await normalizeCommunityArtworkImage(originalBytes, file.type);
    const storageProvider = getBackendMode() === "local" ? "local" : getMediaUploadProvider() === "r2" ? "r2" : "supabase";
    const reservation = await reserveCommunityArtworkUpload({
      reservationToken: randomUUID(),
      productId: safeProductId,
      idempotencyKey: safeIdempotencyKey,
      storageProvider,
      contentType: image.contentType,
      originalSizeBytes: originalBytes.byteLength,
      sizeBytes: image.bytes.byteLength,
      description: safeDescription,
      uploadFingerprint: communityUploadFingerprint({
        originalSha256: image.originalSha256,
        normalizedSha256: image.normalizedSha256,
        productId: safeProductId,
        description: safeDescription,
      }),
    });

    if (reservation.state === "finalized") {
      const artwork = await getMyCommunityArtwork(reservation.artworkId);
      if (!artwork) throw new CommunityConflictError("This artwork is no longer available.");
      return communityJson({ ok: true, artwork });
    }
    if (reservation.state === "reserved" && !await consumeCommunityRateLimit("artwork-upload", actor.userId, 6, 60 * 60)) {
      await scheduleCommunityArtworkUploadCleanup(safeIdempotencyKey, reservation.leaseToken).catch(() => undefined);
      await processCommunityArtworkCleanup(actor);
      throw new CommunityRateLimitError("You have reached the upload limit. Try again later.");
    }
    const expectedPath = `community/${actor.userId}/${safeIdempotencyKey}`;
    if (reservation.storagePath !== expectedPath || reservation.storageProvider !== storageProvider) {
      throw new Error("Community upload reservation is unavailable.");
    }

    if (reservation.state === "reserved") {
      await processCommunityArtworkCleanup(actor);
      try {
        await storeCommunityArtworkImage({
          authorId: actor.userId,
          idempotencyKey: safeIdempotencyKey,
          bytes: image.bytes,
          contentType: image.contentType,
        });
      } catch {
        // A prior request may have stored the same object but died before its durable mark.
        try {
          const existing = await readCommunityArtworkImage({
            authorId: actor.userId,
            storagePath: reservation.storagePath,
            storageProvider: reservation.storageProvider,
          });
          if (Buffer.compare(Buffer.from(existing), Buffer.from(image.bytes)) !== 0) throw new Error("Object mismatch.");
        } catch {
          await scheduleCommunityArtworkUploadCleanup(safeIdempotencyKey, reservation.leaseToken).catch(() => undefined);
          await processCommunityArtworkCleanup(actor);
          throw new CommunityConflictError("This upload could not be safely retried. Choose the image again.");
        }
      }
      try {
        await markCommunityArtworkUploadStored(safeIdempotencyKey, reservation.leaseToken);
      } catch (error) {
        if (error instanceof CommunityConflictError || error instanceof CommunityValidationError
          || error instanceof CommunityAuthorizationError) {
          await scheduleCommunityArtworkUploadCleanup(safeIdempotencyKey, reservation.leaseToken).catch(() => undefined);
          await processCommunityArtworkCleanup(actor);
        }
        throw error;
      }
    }

    let artworkId: string;
    try {
      artworkId = await finalizeCommunityArtworkUpload(safeIdempotencyKey, reservation.leaseToken);
    } catch (finalizeError) {
      // A timeout can hide a committed RPC. Reread the reservation and retry only while our lease still owns it.
      let current;
      try {
        current = await getCommunityUploadReservation(safeIdempotencyKey);
      } catch {
        return communityJson({ ok: false, error: "unavailable", message: "Your upload is still being checked. Retry this same upload shortly." }, 503);
      }
      if (current?.state === "finalized" && current.artworkId) {
        artworkId = current.artworkId;
      } else if (current?.state === "stored" && current.leaseToken === reservation.leaseToken) {
        try {
          artworkId = await finalizeCommunityArtworkUpload(safeIdempotencyKey, reservation.leaseToken);
        } catch {
          if (finalizeError instanceof CommunityConflictError || finalizeError instanceof CommunityValidationError
            || finalizeError instanceof CommunityAuthorizationError) {
            await scheduleCommunityArtworkUploadCleanup(safeIdempotencyKey, reservation.leaseToken).catch(() => undefined);
            await processCommunityArtworkCleanup(actor);
          }
          return communityErrorResponse(finalizeError, "This upload could not be completed. Retry with the same image.");
        }
      } else {
        return communityErrorResponse(finalizeError, "This upload is no longer current. Retry with the same image.");
      }
    }

    const artwork = await getMyCommunityArtwork(artworkId);
    if (!artwork) return communityJson({ ok: false, error: "unavailable", message: "Your upload was saved but could not be loaded yet." }, 503);
    return communityJson({ ok: true, artwork });
  } catch (error) {
    return communityErrorResponse(error, "This upload key is already being used. Retry with the same image.");
  }
}

function disabledResponse() {
  return NextResponse.json({ ok: false, error: "unavailable", message: "Artwork uploads are currently unavailable." }, {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
