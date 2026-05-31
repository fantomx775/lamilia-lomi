export type CookieConsent = {
  essential: true;
  analytics: boolean;
};

export const businessEvents = [
  "page_view",
  "amazon_link_click",
  "registration",
  "email_verification_success",
  "unlock_success",
  "unlock_failure",
  "premium_file_download",
  "video_play",
  "contact_form_submit",
  "language_change",
] as const;

export type BusinessEventName = (typeof businessEvents)[number];

export function shouldLoadGa4(consent: CookieConsent | null, ga4Id?: string) {
  return Boolean(consent?.analytics && ga4Id);
}

export function buildBusinessEventPayload(
  eventName: BusinessEventName,
  values: Record<string, string | number | boolean | undefined> = {},
) {
  return {
    eventName,
    values,
    occurredAt: new Date().toISOString(),
  };
}
