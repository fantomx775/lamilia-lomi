import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/proxy";

const handleI18nRouting = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const response = request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/api")
    ? NextResponse.next({ request })
    : handleI18nRouting(request);

  return updateSession(request, response);
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
};
