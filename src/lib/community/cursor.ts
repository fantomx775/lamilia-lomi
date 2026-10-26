const UTC_CURSOR_TIMESTAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?)(Z|\+00:00)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Timestamp cursors retain database microseconds; never round through JS Date. */
export function encodeCommunityTimestampCursor(timestamp: string, id: string) {
  const normalized = normalizeUtcTimestamp(timestamp);
  if (!normalized || !UUID.test(id)) throw new Error("Invalid community cursor values.");
  return Buffer.from(`${normalized}|${id}`).toString("base64url");
}

export function decodeCommunityTimestampCursor(cursor: string | null | undefined) {
  if (!cursor || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    if (separator < 0) return null;
    const timestamp = normalizeUtcTimestamp(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (!timestamp || !UUID.test(id)) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}

function normalizeUtcTimestamp(timestamp: string) {
  const match = timestamp.match(UTC_CURSOR_TIMESTAMP);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match[1].slice(0, 19).split(/[-T:]/).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return `${match[1]}Z`;
}
