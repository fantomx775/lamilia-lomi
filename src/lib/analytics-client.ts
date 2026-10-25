import type { CookieConsent } from "./analytics";

export const ga4Id = "G-NG67S3HPQZ";
export const consentKey = "ll_cookie_consent";
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; "ga-disable-G-NG67S3HPQZ"?: boolean };
let initialized = false;
let lastPage: string | undefined;
let deniedInMemory = false;
const denialCookie = "ll_analytics_denied";

function hasDenialCookie() {
  return document.cookie.split(";").some(value => value.trim() === `${denialCookie}=1`);
}

/** Return whether the choice was persisted, so withdrawal never reloads stale consent. */
export function writeConsent(analytics: boolean) {
  deniedInMemory = !analytics;
  let persisted = false;
  try {
    localStorage.setItem(consentKey, JSON.stringify({ essential: true, analytics }));
    persisted = true;
  } catch { deniedInMemory = true; }
  // A necessary preference cookie backs up denial when localStorage writes fail.
  document.cookie = `${denialCookie}=${deniedInMemory ? "1" : ""}; path=/; Max-Age=${deniedInMemory ? 31536000 : 0}; SameSite=Lax`;
  return persisted || (!analytics && hasDenialCookie());
}

export function readConsent(): CookieConsent | null {
  if (deniedInMemory || hasDenialCookie()) return { essential: true, analytics: false };
  try {
    const value = JSON.parse(localStorage.getItem(consentKey) ?? "null");
    return value?.essential === true && typeof value.analytics === "boolean" ? value : null;
  } catch { return null; }
}

export function trackEvent(name: string, values: Record<string, string | number> = {}) {
  if (readConsent()?.analytics !== true) return;
  const target = window as AnalyticsWindow;
  if (target[`ga-disable-${ga4Id}`]) return;
  target.gtag?.("event", name, { ...values, page_location: location.origin + location.pathname, send_to: ga4Id });
}

export function startAnalytics() {
  if (readConsent()?.analytics !== true) return;
  const target = window as AnalyticsWindow;
  target[`ga-disable-${ga4Id}`] = false;
  if (initialized) return;
  initialized = true;
  target.dataLayer = target.dataLayer || [];
  // Google's command queue uses Arguments objects, rather than arrays.
  // eslint-disable-next-line prefer-rest-params
  target.gtag = function () { target.dataLayer!.push(arguments); };
  target.gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  target.gtag("consent", "update", { analytics_storage: "granted" });
  target.gtag("js", new Date());
  target.gtag("config", ga4Id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: location.origin + location.pathname,
    page_referrer: document.referrer ? new URL(document.referrer).origin : "",
  });
}

export function trackPage(path: string) {
  if (readConsent()?.analytics !== true || path === lastPage) return;
  lastPage = path;
  // Update the default URL for subsequent events after client navigation.
  (window as AnalyticsWindow).gtag?.("set", { page_location: location.origin + path });
  trackEvent("page_view", { page_location: location.origin + path, page_path: path });
}

export function stopAnalytics() {
  const target = window as AnalyticsWindow;
  target[`ga-disable-${ga4Id}`] = true;
  if (target.dataLayer) target.dataLayer.length = 0;
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0].trim();
    if (!/^_ga(?:_|$)|^_gid$|^_gat/.test(name)) continue;
    document.cookie = `${name}=; Max-Age=0; path=/`;
    const parts = location.hostname.split(".");
    for (let i = 0; i < parts.length; i++) {
      document.cookie = `${name}=; Max-Age=0; path=/; domain=.${parts.slice(i).join(".")}`;
    }
  }
}
