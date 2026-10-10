"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { hasAdminAccess } from "@/lib/auth";
import {
  archiveProductForRequest,
  deleteCategoryForRequest,
  deleteProductForRequest,
  deleteTagForRequest,
  saveCategoryForRequest,
  saveCatalogSettingsForRequest,
  savePageForRequest,
  savePagesForRequest,
  saveProductForRequest,
  saveTagForRequest,
} from "@/lib/supabase-content-admin";
import { getDemoSession } from "@/lib/session.server";
import { parseCatalogDesktopColumns } from "@/lib/catalog-settings";
import type { StaticPageRecord } from "@/lib/types";
import {
  mapAdminError,
  type AdminErrorCode,
  type AdminMutationResult,
} from "@/lib/admin-errors";
import { captureProductSaveFormValues, type ProductSaveFormState } from "@/lib/product-save-form-state";

export async function saveProductAction(formData: FormData): Promise<AdminMutationResult> {
  await assertAdmin();

  const result = await executeAdminMutation("product mutation", () => saveProductForRequest(formData));

  if (result.ok) {
    revalidateContentPaths();
  }

  return result;
}

export async function saveNewProductFormAction(
  _previousState: ProductSaveFormState,
  formData: FormData,
): Promise<ProductSaveFormState> {
  const result = await saveProductAction(formData);

  if (!result.ok) {
    return { errors: result.errors, values: captureProductSaveFormValues(formData) };
  }

  redirect(`/admin/products/${result.id}?saved=1`);
}

export async function saveExistingProductFormAction(
  _previousState: ProductSaveFormState,
  formData: FormData,
): Promise<ProductSaveFormState> {
  const result = await saveProductAction(formData);

  if (!result.ok) {
    return { errors: result.errors, values: captureProductSaveFormValues(formData) };
  }

  redirect(`/admin/products/${result.id}?saved=1`);
}

export async function deleteProductAction(formData: FormData) {
  await assertAdmin();

  const result = await executeAdminMutation("product deletion", () => deleteProductForRequest(String(formData.get("id") ?? "")));

  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/products", result.errors));
  }

  redirect("/admin/products?deleted=1");
}

export async function archiveProductAction(formData: FormData) {
  await assertAdmin();

  const result = await executeAdminMutation("product archive", () => archiveProductForRequest(String(formData.get("id") ?? "")));

  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/products", result.errors));
  }

  redirect("/admin/products?archived=1");
}

export async function saveCategoryAction(formData: FormData) {
  await assertAdmin();

  const result = await executeAdminMutation("category", () => saveCategoryForRequest(formData));

  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/categories", result.errors));
  }

  redirect("/admin/categories?saved=1");
}

export async function deleteCategoryAction(formData: FormData) {
  await assertAdmin();

  const result = await executeAdminMutation("category deletion", () => deleteCategoryForRequest(String(formData.get("id") ?? "")));
  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/categories", result.errors));
  }

  const query = new URLSearchParams({ deleted: "1" });
  if (result.cleanupDeferred) {
    query.set("cleanupDeferred", "1");
    query.set("categoryId", result.id);
  }
  redirect(`/admin/categories?${query.toString()}`);
}

export async function saveCategoryInlineAction(formData: FormData) {
  await assertAdmin();
  const result = await executeAdminMutation("category", () => saveCategoryForRequest(formData));
  revalidateContentPaths();
  return result;
}

export async function deleteCategoryInlineAction(formData: FormData) {
  await assertAdmin();
  const result = await executeAdminMutation("category deletion", () => deleteCategoryForRequest(String(formData.get("id") ?? "")));
  revalidateContentPaths();
  return result;
}

export async function saveTagAction(formData: FormData) {
  await assertAdmin();

  const result = await executeAdminMutation("tag", () => saveTagForRequest(formData));

  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/tags", result.errors));
  }

  redirect("/admin/tags?saved=1");
}

export async function saveCatalogSettingsAction(formData: FormData) {
  await assertAdmin();

  const desktopColumns = parseCatalogDesktopColumns(
    formData.get("desktopColumns"),
  );

  if (desktopColumns === null) {
    redirect("/admin/settings?error=invalid_catalog_columns");
  }

  const result = await executeAdminMutation("catalog settings", () =>
    saveCatalogSettingsForRequest(desktopColumns),
  );

  revalidateContentPaths();

  if (!result.ok) {
    redirect("/admin/settings?error=save_failed");
  }

  redirect("/admin/settings?saved=1");
}

export async function deleteTagAction(formData: FormData) {
  await assertAdmin();

  const result = await executeAdminMutation("tag deletion", () => deleteTagForRequest(String(formData.get("id") ?? "")));
  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/tags", result.errors));
  }

  redirect("/admin/tags?deleted=1");
}

export async function saveTagInlineAction(formData: FormData) {
  await assertAdmin();
  const result = await executeAdminMutation("tag", () => saveTagForRequest(formData));
  revalidateContentPaths();
  return result;
}

export async function deleteTagInlineAction(formData: FormData) {
  await assertAdmin();
  const result = await executeAdminMutation("tag deletion", () => deleteTagForRequest(String(formData.get("id") ?? "")));
  revalidateContentPaths();
  return result;
}

export async function saveStaticPageAction(formData: FormData) {
  await assertAdmin();

  const result = await executeAdminMutation("static page", () => savePageForRequest(formData));
  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/pages", result.errors));
  }

  redirect("/admin/pages?saved=1");
}

export async function saveStaticPagesAction(slug: StaticPageRecord["slug"], formData: FormData) {
  await assertAdmin();
  const result = await executeAdminMutation("static page", () => savePagesForRequest(formData, slug));
  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError(`/admin/pages/${slug}`, result.errors));
  }

  redirect(`/admin/pages/${result.id}?saved=1`);
}

async function assertAdmin() {
  try {
    const session = await getDemoSession();

    if (hasAdminAccess(session)) {
      return;
    }
  } catch (error) {
    console.error("[admin-auth] Could not load the administrator session.", error);
  }

  redirect("/pl/login?error=invalid&returnTo=/admin");
}

function revalidateContentPaths() {
  revalidatePath("/admin", "layout");
  revalidatePath("/en", "layout");
  revalidatePath("/pl", "layout");
  revalidatePath("/de", "layout");
  revalidatePath("/es", "layout");
  revalidatePath("/sitemap.xml");
}

function withAdminError(path: string, errors: AdminErrorCode[]) {
  const url = new URL(path, "http://local.test");

  url.searchParams.set("error", errors.join(","));

  return `${url.pathname}${url.search}`;
}

async function executeAdminMutation(
  operation: string,
  mutation: () => Promise<AdminMutationResult>,
): Promise<AdminMutationResult> {
  try {
    return await mutation();
  } catch (error) {
    return { ok: false, errors: [mapAdminError(error, operation)] };
  }
}
