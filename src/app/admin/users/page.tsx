import { getAdminUserRowsForRequest } from "@/lib/admin-users";

import { UsersResourceList, type AdminUserListRow } from "./users-list";

export default async function AdminUsersPage() {
  let rows: AdminUserListRow[] = [];
  let loadError = false;

  try {
    rows = await getAdminUserRowsForRequest();
  } catch {
    loadError = true;
    console.error("Admin users data load failed.");
  }

  return <UsersResourceList rows={rows} loadError={loadError} />;
}
