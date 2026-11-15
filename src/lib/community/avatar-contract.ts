export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;
export const AVATAR_MAX_PIXELS = 24_000_000;
export const AVATAR_EDGE = 384;
export const AVATAR_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function isAvatarInputType(value: string | null): boolean {
  return AVATAR_INPUT_TYPES.some((type) => type === value);
}

export const isAvatarId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export type AvatarView = { approvedId: string | null; pending: boolean; rejected: boolean };
