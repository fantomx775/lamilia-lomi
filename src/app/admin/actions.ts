"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { hasAdminAccess } from "@/lib/auth";
import {
  archiveProduct,
  deleteCategory,
  deleteProduct,
  deleteTag,
  saveCategoryFromFormData,
  saveProductFromFormData,
  saveStaticPageFromFormData,
  saveTagFromFormData,
} from "@/lib/admin-content";
import { getDemoSession } from "@/lib/session.server";

export async function saveProductAction(formData: FormData) {
  await assertAdmin();

  const result = saveProductFromFormData(formData);

  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError(returnTo(formData, "/admin/products/new"), result.errors));
  }

  redirect(`/admin/products/${result.id}?saved=1`);
}

export async function deleteProductAction(formData: FormData) {
  await assertAdmin();

  const result = deleteProduct(String(formData.get("id") ?? ""));

  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/products", result.errors));
  }

  redirect("/admin/products?deleted=1");
}

export async function archiveProductAction(formData: FormData) {
  await assertAdmin();

  const result = archiveProduct(String(formData.get("id") ?? ""));

  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/products", result.errors));
  }

  redirect("/admin/products?archived=1");
}

export async function saveCategoryAction(formData: FormData) {
  await assertAdmin();

  const result = saveCategoryFromFormData(formData);

  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/categories", result.errors));
  }

  redirect("/admin/categories?saved=1");
}

export async function deleteCategoryAction(formData: FormData) {
  await assertAdmin();

  deleteCategory(String(formData.get("id") ?? ""));
  revalidateContentPaths();
  redirect("/admin/categories?deleted=1");
}

export async function saveTagAction(formData: FormData) {
  await assertAdmin();

  const result = saveTagFromFormData(formData);

  revalidateContentPaths();

  if (!result.ok) {
    redirect(withAdminError("/admin/tags", result.errors));
  }

  redirect("/admin/tags?saved=1");
}

export async function deleteTagAction(formData: FormData) {
  await assertAdmin();

  deleteTag(String(formData.get("id") ?? ""));
  revalidateContentPaths();
  redirect("/admin/tags?deleted=1");
}

export async function saveStaticPageAction(formData: FormData) {
  await assertAdmin();

  saveStaticPageFromFormData(formData);
  revalidateContentPaths();
  redirect("/admin/pages?saved=1");
}

async function assertAdmin() {
  const session = await getDemoSession();

  if (!hasAdminAccess(session)) {
    throw new Error("Unauthorized admin action.");
  }
}

function revalidateContentPaths() {
  revalidatePath("/admin", "layout");
  revalidatePath("/en", "layout");
  revalidatePath("/pl", "layout");
  revalidatePath("/de", "layout");
  revalidatePath("/es", "layout");
  revalidatePath("/sitemap.xml");
}

function returnTo(formData: FormData, fallback: string) {
  const value = formData.get("returnTo");

  return typeof value === "string" && value.startsWith("/admin") ? value : fallback;
}

function withAdminError(path: string, errors: string[]) {
  const url = new URL(path, "http://local.test");

  url.searchParams.set("error", errors.join(" | "));

  return `${url.pathname}${url.search}`;
}
