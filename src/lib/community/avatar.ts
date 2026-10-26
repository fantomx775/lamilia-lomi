const AVATAR_COLORS = [
  "var(--color-sage)",
  "var(--color-blush)",
  "var(--color-bg-alt)",
  "#e7dce7",
] as const;

export function getCommunityAvatarPresentation(username: string, seed: string) {
  const cleanName = username.trim().replace(/^@/, "");
  const initials = cleanName
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || cleanName.slice(0, 2).toUpperCase() || "?";
  let hash = 2166136261;
  for (const character of `${cleanName.toLowerCase()}:${seed}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  const color = AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length];
  return { initials, color };
}
