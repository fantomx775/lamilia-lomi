import type { Locale } from "@/i18n/routing";

export type ProductStatus = "draft" | "published" | "archived";
export type Audience = "kids" | "adults";
export type AssetKind =
  | "cover"
  | "gallery"
  | "video"
  | "public_download"
  | "premium_download";
export type UserRole = "user" | "admin";
export type ReminderStatus = "pending" | "sent" | "failed" | "cancelled";

export type ProductTranslation = {
  locale: Locale;
  title: string;
  shortDescription: string;
  longDescription: string;
  seoTitle?: string;
  seoDescription?: string;
};

export type TaxonomyTranslation = {
  locale: Locale;
  name: string;
  description?: string;
};

export type Category = {
  id: string;
  slug: string;
  sortOrder: number;
  translations: TaxonomyTranslation[];
};

export type Tag = {
  id: string;
  slug: string;
  translations: TaxonomyTranslation[];
};

export type ProductAsset = {
  id: string;
  productId: string;
  kind: AssetKind;
  bucket: string;
  path: string;
  filename: string;
  contentType: string;
  sizeBytes?: number;
  locale?: Locale;
  title?: string;
  sortOrder: number;
  isPublic: boolean;
  demoDownloadPath?: string;
};

export type AmazonLink = {
  id: string;
  productId: string;
  market: "amazon.com" | "amazon.de";
  url: string;
  isPrimary: boolean;
};

export type PremiumCode = {
  id: string;
  productId: string;
  code: string;
  active: boolean;
};

export type StaticPageRecord = {
  id: string;
  slug: "privacy" | "terms";
  locale: Locale;
  title: string;
  body: string;
  updatedAt: string;
};

export type ContentSnapshot = {
  products: Product[];
  categories: Category[];
  tags: Tag[];
  staticPages: StaticPageRecord[];
};

export type Product = {
  id: string;
  slug: string;
  status: ProductStatus;
  audience: Audience;
  productType: string;
  coverAssetId: string;
  videoAssetId?: string;
  reviewDelayDays: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  translations: ProductTranslation[];
  categoryIds: string[];
  tagIds: string[];
  assets: ProductAsset[];
  amazonLinks: AmazonLink[];
  premiumCodes: PremiumCode[];
};

export type LocalizedProductView = {
  id: string;
  slug: string;
  status: ProductStatus;
  audience: Audience;
  audienceLabel: string;
  productType: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  seoTitle: string;
  seoDescription: string;
  cover: ProductAsset;
  gallery: ProductAsset[];
  video?: ProductAsset;
  premiumAssets: ProductAsset[];
  categories: Array<Category & { name: string }>;
  tags: Array<Tag & { name: string }>;
  amazonLinks: AmazonLink[];
  primaryAmazonLink?: AmazonLink;
  reviewDelayDays: number;
};

export type CatalogFilters = {
  q?: string;
  audience?: Audience;
  productType?: string;
  category?: string;
  tag?: string;
  sort: "manual" | "newest" | "az";
};

export type DemoSession = {
  email: string;
  role: UserRole;
  emailVerified: boolean;
  marketingConsent: boolean;
  termsAcceptedAt: string;
  preferredLocale: Locale;
  unlockedProductIds: string[];
};

export type DownloadDecision =
  | { allowed: true; reason: "allowed" }
  | {
      allowed: false;
      reason: "guest" | "unverified" | "locked" | "wrong_asset";
    };
