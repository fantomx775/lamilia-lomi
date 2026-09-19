import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "./i18n/routing";
import { hasSupabaseAuthCookie } from "./lib/supabase/auth-cookie";
import { updateSession } from "./lib/supabase/proxy";

const handleI18nRouting = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const response = request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/api")
    ? NextResponse.next({ request })
    : handleI18nRouting(request);

  return updateSessionIfNeeded(request, response);
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
};

function updateSessionIfNeeded(request: NextRequest, response: NextResponse) {
  const isApiRequest = request.nextUrl.pathname.startsWith("/api");

  // Sessions are cookie-backed. A guest page cannot refresh a session it does not have.
  return isApiRequest || hasSupabaseAuthCookie(request.cookies.getAll())
    ? updateSession(request, response)
    : response;
}
