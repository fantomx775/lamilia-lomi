# PR #45 English-only verification

The focused browser checks and screenshot review are identified by local demo backend Playwright run `pr-45-focused-final-route-auth-unlock-editors-r20-malformed-opaque-url-redaction-20261011`. Its Playwright records report the exact tested SHA and result. The route spec emits separate `PR45_BROWSER_SCREENSHOT` and `PR45_BROWSER_DIAGNOSTICS` records. The unlock spec emits per-test `PR45_BROWSER_DIAGNOSTICS` records with request details and timing. The editor spec attaches `BROWSER_EVIDENCE` JSON with the run ID, exact tested SHA, browser project, test title, screenshot paths, and diagnostics; unlock and route records use different shapes and do not all include screenshot paths.

The run covers English-only public navigation and content, removal of the language selector, 308 redirects from legacy `/pl`, `/de`, and `/es` routes with query preservation, QR unlock redirects, login and registration return targets, guest and authenticated unlock/download behavior, and single-language product, category, and Terms editor save/reload flows. It runs the focused route, unlock, and editor specs on desktop Chromium and Pixel 7 mobile Chromium.

## Screenshots reviewed for the current run

- [English home, desktop](english-home-desktop.png)
- [English home, mobile](english-home-mobile.png)
- [Single-language product editor, desktop](product-editor-chromium.png)
- [Single-language product editor, mobile](product-editor-mobile.png)
- [Single-language category editor, desktop](category-editor-chromium.png)
- [Single-language category editor, mobile](category-editor-mobile.png)
- [Single-language Terms editor, desktop](terms-editor-chromium.png)
- [Single-language Terms editor, mobile](terms-editor-mobile.png)

The route checks record no console errors, page errors, or failed requests. In the unlock cases, the only console error and failed response is the deliberate `GET /en/unlock/not-a-product` 404 on desktop and mobile, which the test asserts. Other failed requests are `net::ERR_ABORTED` font, route-transition, or Server Action requests during the next asserted navigation; the per-test diagnostics record their URL, error, request metadata, and timing. Editor captures record expected `net::ERR_ABORTED` navigation, Server Action, route-transition, or font requests while the test advances to its next asserted route; saved values and public route content are verified again after reload.
