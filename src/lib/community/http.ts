import { NextResponse } from "next/server";

import {
  CommunityAuthorizationError,
  CommunityConflictError,
  CommunityRateLimitError,
  CommunityValidationError,
} from "./errors";

export const COMMUNITY_MAX_JSON_BYTES = 8 * 1024;

export function isSameOriginCommunityRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const target = new URL(request.url);
    // Next's development HTTPS proxy can normalize the internal URL to localhost.
    // The browser's Host remains the target authority; never trust forwarded-host.
    const host = request.headers.get("host");
    if (host) {
      target.host = host;
      if (target.host.toLowerCase() !== host.toLowerCase()) return false;
    }
    return origin === new URL(origin).origin && origin === target.origin;
  } catch {
    return false;
  }
}

export type BoundedBodyResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "invalid_encoding" };

export async function readBoundedBody(request: Request): Promise<BoundedBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > COMMUNITY_MAX_JSON_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > COMMUNITY_MAX_JSON_BYTES) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "invalid_encoding" };
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedBinaryBody(request: Request, maxBytes: number): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "too_large" | "invalid_body" }
> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) return { ok: false, reason: "invalid_body" };
    if (Number(declaredLength) > maxBytes) return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: false, reason: "invalid_body" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { ok: false, reason: "invalid_body" };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function readBoundedJson(request: Request): Promise<
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid_body" }
> {
  const body = await readBoundedBody(request);
  if (!body.ok) return body.reason === "too_large"
    ? { ok: false, reason: "too_large" }
    : { ok: false, reason: "invalid_body" };
  try {
    return { ok: true, value: JSON.parse(body.text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_body" };
  }
}

export function communityJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export function communityErrorResponse(error: unknown, conflictMessage = "That username is unavailable. Try another.") {
  if (error instanceof CommunityConflictError) {
    return communityJson({ ok: false, error: "conflict", message: conflictMessage }, 409);
  }
  if (error instanceof CommunityRateLimitError) {
    return NextResponse.json({ ok: false, error: "rate_limited", message: error.message }, {
      status: 429,
      headers: { "Cache-Control": "private, no-store", "Retry-After": "3600", "X-Content-Type-Options": "nosniff" },
    });
  }
  if (error instanceof CommunityAuthorizationError) {
    return communityJson({ ok: false, error: "forbidden", message: error.message }, 403);
  }
  if (error instanceof CommunityValidationError) {
    return communityJson({ ok: false, error: "invalid_input", message: error.message }, 400);
  }
  return communityJson({ ok: false, error: "unavailable", message: "Community settings are temporarily unavailable." }, 503);
}

export function bodyErrorResponse(reason: "too_large" | "invalid_body" | "invalid_encoding") {
  return reason === "too_large"
    ? communityJson({ ok: false, error: "body_too_large", message: "The request is too large." }, 413)
    : communityJson({ ok: false, error: "invalid_body", message: "Send a valid JSON request." }, 400);
}
