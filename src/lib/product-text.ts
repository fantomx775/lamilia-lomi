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
