export function isUnlocalizedAuthPath(pathname: string) {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}

export function shouldBypassLocaleRouting(pathname: string) {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api") ||
    isUnlocalizedAuthPath(pathname)
  );
}
