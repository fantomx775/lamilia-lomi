const prefix = "/storage/v1/upload/resumable";
const permittedOrigins = new Set(["http://127.0.0.1:55421", "http://localhost:55421", "https://localhost:3443"]);
const isTusPath = (value) => value === prefix || value.startsWith(prefix + "/");

/** Local test gateway only. Opaque upload paths/queries never enter logs. */
export function rewriteIsolatedTusLocation(requestPath, location) {
  const request = new URL(requestPath, "https://localhost:3443");
  const target = new URL(location, "http://127.0.0.1:55421");
  if (request.origin !== "https://localhost:3443" || !isTusPath(request.pathname) || request.username || request.password || request.hash ||
    !permittedOrigins.has(target.origin) || !isTusPath(target.pathname) || target.username || target.password || target.hash) {
    throw new Error("Refusing an unexpected isolated Storage upload location.");
  }
  const rewritten = new URL("https://localhost:3443");
  rewritten.pathname = target.pathname;
  rewritten.search = target.search;
  return rewritten.href;
}
