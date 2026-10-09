export function isLoopbackPlaywrightTarget(baseURL: unknown): boolean {
  if (typeof baseURL !== "string" || !baseURL.trim()) return false;

  try {
    const target = new URL(baseURL);
    if (target.protocol !== "http:" && target.protocol !== "https:") return false;
    if (target.username || target.password) return false;

    const hostname = target.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
