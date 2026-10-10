import { AppConfigurationError } from "./config";

export type MediaStorageProvider =
  | "supabase"
  | "r2_private"
  | "r2_public_pending"
  | "r2_public_revoking"
  | "r2_public";
export type MediaUploadProvider = "supabase" | "r2";

type EnvLike = Record<string, string | undefined>;

export type R2StorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  privateBucket: string;
  publicBucket: string;
  publicBaseUrl: string;
};

export function getMediaUploadProvider(env: EnvLike = process.env): MediaUploadProvider {
  const value = (env.MEDIA_STORAGE_PROVIDER ?? "supabase").trim().toLowerCase();

  if (value === "supabase") return "supabase";
  if (value !== "r2") {
    throw new AppConfigurationError(
      "MEDIA_STORAGE_PROVIDER must be set to supabase or r2.",
    );
  }

  getR2StorageConfig(env);
  return "r2";
}

export function getR2StorageConfig(env: EnvLike = process.env): R2StorageConfig {
  const values = {
    accountId: env.R2_ACCOUNT_ID?.trim() ?? "",
    accessKeyId: env.R2_ACCESS_KEY_ID?.trim() ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim() ?? "",
    privateBucket: env.R2_PRIVATE_BUCKET?.trim() ?? "",
    publicBucket: env.R2_PUBLIC_BUCKET?.trim() ?? "",
    publicBaseUrl: env.R2_PUBLIC_BASE_URL?.trim() ?? "",
  };
  const missing = [
    values.accountId ? null : "R2_ACCOUNT_ID",
    values.accessKeyId ? null : "R2_ACCESS_KEY_ID",
    values.secretAccessKey ? null : "R2_SECRET_ACCESS_KEY",
    values.privateBucket ? null : "R2_PRIVATE_BUCKET",
    values.publicBucket ? null : "R2_PUBLIC_BUCKET",
    values.publicBaseUrl ? null : "R2_PUBLIC_BASE_URL",
  ].filter((name): name is string => Boolean(name));

  if (missing.length) {
    throw new AppConfigurationError(
      `R2 media configuration is missing: ${missing.join(", ")}.`,
    );
  }

  if (!/^[a-f0-9]{32}$/i.test(values.accountId)) {
    throw new AppConfigurationError("R2_ACCOUNT_ID must be a Cloudflare account ID.");
  }

  if (values.privateBucket === values.publicBucket) {
    throw new AppConfigurationError(
      "R2_PRIVATE_BUCKET and R2_PUBLIC_BUCKET must name different buckets.",
    );
  }

  const publicBaseUrl = parseR2PublicBaseUrl(values.publicBaseUrl);
  if (!publicBaseUrl) {
    throw new AppConfigurationError(
      "R2_PUBLIC_BASE_URL must be an HTTPS origin without a path, query, or fragment.",
    );
  }

  return { ...values, publicBaseUrl };
}

export function getR2PublicBaseUrl(env: EnvLike = process.env) {
  const value = env.R2_PUBLIC_BASE_URL?.trim();
  return value ? parseR2PublicBaseUrl(value) : null;
}

export function parseR2PublicBaseUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }

  return parsed.origin;
}

export function r2PublicMediaUrl(baseUrl: string, storagePath: string) {
  const base = parseR2PublicBaseUrl(baseUrl);
  if (!base || !isSafeMediaStoragePath(storagePath)) return null;

  const encodedPath = storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/${encodedPath}`;
}

export function isSafeMediaStoragePath(value: string) {
  return (
    value.startsWith("products/") &&
    value.split("/").length === 4 &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..")
  );
}
