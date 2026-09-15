export function isHtmlDocumentRequest(headers: Headers) {
  const destination = headers.get("sec-fetch-dest")?.toLowerCase();

  if (destination !== undefined && destination !== null) {
    return destination === "document";
  }

  if (headers.get("purpose")?.toLowerCase() === "prefetch") {
    return false;
  }

  return (
    headers
      .get("accept")
      ?.split(",")
      .some((mediaType) => mediaType.trim().split(";")[0]?.toLowerCase() === "text/html") ??
    false
  );
}
