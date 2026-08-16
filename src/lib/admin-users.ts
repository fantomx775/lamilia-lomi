import "server-only";

import { getBackendMode } from "@/lib/config";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { createServiceRoleClient } from "@/lib/supabase/admin";
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

  const supabase = createServiceRoleClient();
  const [{ data: authData, error: authError }, { data: profiles, error: profilesError }, { data: unlocks, error: unlocksError }, snapshot] = await Promise.all([
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("profiles").select("id, role, marketing_consent"),
    supabase.from("user_product_unlocks").select("user_id, product_id"),
    getAdminContentSnapshot(),
  ]);

  if (authError) throw new Error(`Supabase auth user read failed: ${authError.message}`);
  if (profilesError) throw new Error(`Supabase profile read failed: ${profilesError.message}`);
  if (unlocksError) throw new Error(`Supabase unlock read failed: ${unlocksError.message}`);

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const unlocksByUser = new Map<string, string[]>();

  for (const unlock of unlocks ?? []) {
    const current = unlocksByUser.get(unlock.user_id) ?? [];
    current.push(unlock.product_id);
    unlocksByUser.set(unlock.user_id, current);
  }

  return authData.users.map((user) => {
    const profile = profilesById.get(user.id);
    const unlockedProductIds = unlocksByUser.get(user.id) ?? [];

    return {
      id: user.id,
      email: user.email ?? "",
      role: profile?.role === "admin" ? "admin" : "user",
      emailVerified: Boolean(user.email_confirmed_at),
      marketingConsent: Boolean(profile?.marketing_consent),
      unlockCount: unlockedProductIds.length,
      unlockedProducts: unlockedProductIds
        .map((productId) => snapshot.products.find((product) => product.id === productId)?.translations.find((translation) => translation.locale === "en")?.title)
        .filter((title): title is string => Boolean(title)),
    };
  });
}

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
