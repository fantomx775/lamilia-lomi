import { demoUsers } from "@/lib/seed-data";

import { UsersResourceList, type AdminUserListRow } from "./users-list";

export default function AdminUsersPage() {
  const rows: AdminUserListRow[] = demoUsers.map((user) => ({
    id: user.email,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    marketingConsent: user.marketingConsent,
    unlockCount: user.unlockedProductIds.length,
  }));

  return <UsersResourceList rows={rows} />;
}
