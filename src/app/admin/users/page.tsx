import { getAdminUserRowsForRequest } from "@/lib/admin-users";

import { UsersResourceList, type AdminUserListRow } from "./users-list";

export default async function AdminUsersPage() {
  const rows: AdminUserListRow[] = await getAdminUserRowsForRequest();

  return <UsersResourceList rows={rows} />;
}
