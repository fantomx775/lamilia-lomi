export function isUnlocalizedAuthPath(pathname: string) {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}

export function shouldBypassLocaleRouting(pathname: string) {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    isUnlocalizedAuthPath(pathname)
  );
}

export function getEnglishOnlyRedirectUrl(requestUrl: URL): URL | null {
  const target = new URL(requestUrl);
  const englishPathname = getEnglishOnlyPathname(target.pathname);
  let changed = false;

  if (englishPathname) {
    target.pathname = englishPathname;
    changed = true;
  }

  for (const key of ["returnTo", "redirectTo"]) {
    const value = target.searchParams.get(key);

    if (!value) {
      continue;
    }

    try {
      const nestedUrl = new URL(value, target.origin);
      const nestedEnglishPathname =
        nestedUrl.origin === target.origin
          ? getEnglishOnlyPathname(nestedUrl.pathname)
          : null;

      if (!nestedEnglishPathname) {
        continue;
      }

      if (nestedEnglishPathname === nestedUrl.pathname) {
        continue;
      }

      nestedUrl.pathname = nestedEnglishPathname;
      target.searchParams.set(
        key,
        value.startsWith("/")
          ? `${nestedUrl.pathname}${nestedUrl.search}${nestedUrl.hash}`
          : nestedUrl.toString(),
      );
      changed = true;
    } catch {
      // Leave malformed return targets untouched for the existing auth validator.
    }
  }

  return changed ? target : null;
}

function getEnglishOnlyPathname(pathname: string) {
  if (/^\/(?:pl|de|es)(?:\/|$)/.test(pathname)) {
    return pathname.replace(/^\/(?:pl|de|es)(?=\/|$)/, "/en");
  }

  if (/^\/api\/unlock\/(?:pl|de|es)(?:\/|$)/.test(pathname)) {
    return pathname.replace(/^\/api\/unlock\/(?:pl|de|es)(?=\/|$)/, "/api/unlock/en");
  }

  return null;
}
