import { ADMIN_ERROR_CODES, type AdminErrorCode } from "./admin-errors";

export const PRODUCT_TITLE_MAX_LENGTH = 140;
export const PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH = 300;
export const PRODUCT_TEXT_WARNING_THRESHOLD = 20;

export function validateProductTextLengths(title: string, shortDescription: string): AdminErrorCode[] {
  const errors: AdminErrorCode[] = [];

  if (title.length > PRODUCT_TITLE_MAX_LENGTH) {
    errors.push(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_TOO_LONG);
  }

  if (shortDescription.length > PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH) {
    errors.push(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_SHORT_DESCRIPTION_TOO_LONG);
  }

  return errors;
}

// Shared by the editor and the server. Drafts require only a title; checks on
// optional values that are supplied still apply independently of completeness.
export function validateProductCompleteness({
  status,
  title,
  shortDescription,
  hasCover,
  hasAmazonLink,
}: {
  status: "draft" | "published" | "archived";
  title: string;
  shortDescription: string;
  hasCover: boolean;
  hasAmazonLink: boolean;
}): AdminErrorCode[] {
  const errors: AdminErrorCode[] = [];
  if (!title.trim()) errors.push(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_REQUIRED);
  if (status === "published") {
    if (!shortDescription.trim()) errors.push(ADMIN_ERROR_CODES.VALIDATION_PUBLISH_SHORT_DESCRIPTION_REQUIRED);
    if (!hasCover) errors.push(ADMIN_ERROR_CODES.VALIDATION_PUBLISH_COVER_REQUIRED);
    if (!hasAmazonLink) errors.push(ADMIN_ERROR_CODES.VALIDATION_PUBLISH_AMAZON_LINK_REQUIRED);
  }
  return errors;
}
