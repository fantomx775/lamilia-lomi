export function hasSupabaseAuthCookie(cookies: Array<{ name: string }>) {
  return cookies.some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
}
