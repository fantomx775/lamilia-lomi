import { NextResponse } from "next/server";

import {
  exportAdminUsersToCsv,
  getAdminUserRowsForRequest,
} from "@/lib/admin-users";
import { hasAdminAccess } from "@/lib/auth";
import { getDemoSession } from "@/lib/session.server";

export async function GET(request: Request) {
  const session = await getDemoSession();

  if (!hasAdminAccess(session)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const csv = exportAdminUsersToCsv(await getAdminUserRowsForRequest(), {
    marketingOnly: url.searchParams.get("marketingOnly") === "1",
  });

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=lamilialomi-users.csv",
    },
  });
}
