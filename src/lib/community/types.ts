export type CommunityArtworkStatus = "pending" | "approved" | "rejected" | "removed";
export type CommunityStorageProvider = "local" | "supabase" | "r2";
export type CommunityImageContentType = "image/jpeg" | "image/png" | "image/webp";
export type CommunityAudience = "kids" | "adults";

export type CommunityPublicProduct = {
  id: string;
  slug: string;
  title: string;
  audience: CommunityAudience;
};

export type CommunityPublicProductOption = Pick<CommunityPublicProduct, "id" | "slug" | "title" | "audience">;

export type CommunityPublicCreator = {
  username: string;
  avatarSeed: string;
};

/** Allow-listed fields safe for anonymous gallery/detail/profile responses. */
export type CommunityPublicArtwork = {
  id: string;
  product: CommunityPublicProduct;
  creator: CommunityPublicCreator;
  contentType: CommunityImageContentType;
  description: string;
  publishedAt: string;
  likesCount: number;
  likedByMe: boolean;
};

export type CommunityArtworkSort = "latest" | "popular";
export type CommunityHeartAccess = "guest" | "verify" | "join" | "member";
export type CommunityHeartResult = { available: boolean; liked: boolean; likesCount: number };

/** Owner-only projection. It intentionally contains no email, auth ID, or storage path. */
export type CommunityOwnerArtwork = {
  id: string;
  product: CommunityPublicProduct;
  contentType: CommunityImageContentType;
  description: string;
  status: CommunityArtworkStatus;
  revision: number;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Admin projection contains only data needed to moderate; no account email. */
export type CommunityAdminArtwork = CommunityOwnerArtwork & {
  creatorUsername: string | null;
  publishedAt: string | null;
};

export type CommunityAdminProductOption = { id: string; slug: string; title: string };

export type CommunityModerationAction = "approve" | "reject" | "remove" | "restore";
export type CommunityModerationHistoryItem = {
  id: string;
  revision: number;
  fromStatus: CommunityArtworkStatus | null;
  toStatus: CommunityArtworkStatus;
  reason: string | null;
  createdAt: string;
  moderatorLabel: "Administrator";
};
export type CommunityModerationCounts = Record<CommunityArtworkStatus, number>;
export type CommunityReportReason = "rights" | "privacy" | "harmful" | "other";
export type CommunityReportStatus = "open" | "reviewed" | "resolved" | "dismissed";
export type CommunityAdminReport = {
  id: string;
  artworkId: string;
  artworkStatus: CommunityArtworkStatus;
  description: string;
  creatorUsername: string | null;
  product: CommunityPublicProduct;
  reason: CommunityReportReason;
  details: string;
  status: CommunityReportStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
};
export type CommunityReportPage = CommunityPage<CommunityAdminReport> & {
  counts: Record<CommunityReportStatus, number>;
};
export type CommunityModerationPage = CommunityPage<CommunityAdminArtwork> & {
  counts: CommunityModerationCounts;
};

export type CommunityPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type CommunityCreateArtworkInput = {
  productId: string;
  idempotencyKey: string;
  storageProvider: CommunityStorageProvider;
  contentType: CommunityImageContentType;
  sizeBytes: number;
  description?: string;
};

export type CommunityProfileInput = {
  username: string;
  adultAttested: boolean;
};
