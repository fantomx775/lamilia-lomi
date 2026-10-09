import type { AdminErrorCode } from "@/lib/admin-errors";

export type ProductSaveFormState = {
  errors: AdminErrorCode[];
  values: Record<string, string[]> | null;
};

export const emptyProductSaveFormState: ProductSaveFormState = {
  errors: [],
  values: null,
};

export function captureProductSaveFormValues(formData: FormData): Record<string, string[]> {
  const values: Record<string, string[]> = {};

  for (const [name, value] of formData.entries()) {
    if (name.startsWith("$ACTION_") || typeof value !== "string") continue;
    (values[name] ??= []).push(value);
  }

  return values;
}
