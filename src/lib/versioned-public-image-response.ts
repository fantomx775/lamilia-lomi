import { NextResponse } from "next/server";

/**
 * Next Image's internal fetch path accepts image bytes from local routes, but
 * does not follow their redirects. Resolve the already validated public media
 * URL here so versioned local image URLs remain eligible for optimization.
 */
export async function versionedPublicImageResponse(request: Request, sourceUrl: string) {
  let upstream: Response;
  try {
    const parsedSourceUrl = new URL(sourceUrl);
    if (parsedSourceUrl.protocol !== "https:") {
      throw new Error("The public image source must use HTTPS.");
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    upstream = await fetch(parsedSourceUrl, {
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch {
    throw new Error("The public image source request failed.");
  }

  if (upstream.status === 404 || upstream.status === 410) return null;

  const contentType = upstream.headers.get("content-type")?.split(";", 1)[0].trim();
  if (!upstream.ok || !upstream.body || !contentType?.toLowerCase().startsWith("image/")) {
    throw new Error(`The public image source returned HTTP ${upstream.status} or an unsupported content type.`);
  }

  const headers = new Headers({
    "Cache-Control": "public, max-age=60, s-maxage=60",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of ["etag", "last-modified"] as const) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new NextResponse(upstream.body, { headers });
}
