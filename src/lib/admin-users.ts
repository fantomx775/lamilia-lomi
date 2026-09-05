import "server-only";

import { getBackendMode } from "@/lib/config";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { createClient } from "@/lib/supabase/server";
import { demoUsers } from "./seed-data";
import type { UserRole } from "./types";

export type AdminUserRow = {
  id: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  marketingConsent: boolean;
  unlockCount: number;
  unlockedProducts: string[];
};

export async function getAdminUserRowsForRequest(): Promise<AdminUserRow[]> {
  if (getBackendMode() === "local") {
    const { products } = await getAdminContentSnapshot();

    return demoUsers.map((user) => ({
      id: user.email,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      marketingConsent: user.marketingConsent,
      unlockCount: user.unlockedProductIds.length,
      unlockedProducts: user.unlockedProductIds
        .map((productId) => products.find((product) => product.id === productId)?.translations.find((translation) => translation.locale === "en")?.title)
        .filter((title): title is string => Boolean(title)),
    }));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_admin_users");

  if (error) throw new Error(`Supabase admin user read failed: ${error.message}`);

  return ((data ?? []) as unknown as AdminUsersRpcRow[]).map((row) => ({
    id: row.id,
    email: row.email ?? "",
    role: row.role === "admin" ? "admin" : "user",
    emailVerified: Boolean(row.email_verified),
    marketingConsent: Boolean(row.marketing_consent),
    unlockCount: Number(row.unlock_count ?? 0),
    unlockedProducts: Array.isArray(row.unlocked_products)
      ? row.unlocked_products.filter((title): title is string => typeof title === "string")
      : [],
  }));
}

type AdminUsersRpcRow = {
  id: string;
  email: string | null;
  role: string | null;
  email_verified: boolean | null;
  marketing_consent: boolean | null;
  unlock_count: number | string | null;
  unlocked_products: unknown;
};

export function exportAdminUsersToCsv(
  rows: AdminUserRow[],
  options: { marketingOnly?: boolean } = {},
) {
  const data = rows
    .filter((row) => (options.marketingOnly ? row.marketingConsent : true))
    .map((row) => [
      row.email,
      row.role,
      row.emailVerified ? "verified" : "unverified",
      row.marketingConsent ? "yes" : "no",
      row.unlockCount.toString(),
    ]);

  return [
    ["email", "role", "email_status", "marketing_consent", "unlocks"].join(","),
    ...data.map((row) => row.map(csvCell).join(",")),
  ].join("\n");
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
