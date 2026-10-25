# Google Analytics

Measurement ID: `G-NG67S3HPQZ` (public identifier, fixed for this site).

Basic consent mode: no Google library or analytics events before explicit consent. Advertising consent remains denied. Cookie settings below the footer allow withdrawal; GA cookies are removed and the page reloads to unload Google listeners. Consent is validated and synchronized across tabs; inaccessible or corrupt storage fails closed.

Events: `page_view` on initial consent and pathname changes; `amazon_link_click` with product ID and market; `form_submit` with a fixed form name (contact, login, register, unlock); `video_play` and `video_complete` for HTML flipthrough videos. Form submission means an attempt, not successful backend delivery. No form values, premium codes, query strings, hash fragments or signed video URLs are supplied by this instrumentation.

## Google property setup

In the GA4 web stream, turn OFF enhanced measurement for page changes based on browser history, form interactions, outbound clicks and video engagement. This application sends explicit events; leaving automatic collection enabled can duplicate measurements or collect unsanitized URLs/form metadata. Google property settings are external and cannot be changed from this repository.

Validate receipt in GA4 Realtime/DebugView with access to the property. Local browser tests isolate the Google transport and verify consent, queued commands and event wiring, not Google reporting ingestion. Seed flipthrough media is a placeholder, so automated browser coverage uses a synthetic HTML video play/end event.
