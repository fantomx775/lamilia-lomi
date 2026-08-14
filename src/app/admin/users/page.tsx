import { demoUsers } from "@/lib/seed-data";
import { getContentSnapshot } from "@/lib/content-store";

import { UsersResourceList, type AdminUserListRow } from "./users-list";

export default function AdminUsersPage() {
  const { products } = getContentSnapshot();
  const rows: AdminUserListRow[] = demoUsers.map((user) => ({
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

  return <UsersResourceList rows={rows} />;
}
