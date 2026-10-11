# PR #45 English-only verification

The screenshots and focused browser checks listed below are captured locally with the demo backend during Playwright run `pr-45-focused-final-route-auth-unlock-editors-r5-final-harness-20261011`. The route spec logs separate `PR45_BROWSER_SCREENSHOT` and `PR45_BROWSER_DIAGNOSTICS` records. The unlock spec logs per-test `PR45_BROWSER_DIAGNOSTICS` records with request details and elapsed time. The editor spec attaches `BROWSER_EVIDENCE` JSON with the run ID, exact tested SHA, browser project, test title, screenshot paths, and diagnostics.

The run covers English-only public navigation and content, removal of the language selector, 308 redirects from legacy `/pl`, `/de`, and `/es` routes with query preservation, QR unlock redirects, login and registration return targets, guest and authenticated unlock/download behavior, and single-language product, category, and Terms editor save/reload flows. It runs the focused route, unlock, and editor specs on desktop Chromium and Pixel 7 mobile Chromium.

## Screenshots from the current run

- [English home, desktop](english-home-desktop.png)
- [English home, mobile](english-home-mobile.png)
- [Single-language product editor, desktop](product-editor-chromium.png)
- [Single-language product editor, mobile](product-editor-mobile.png)
- [Single-language category editor, desktop](category-editor-chromium.png)
- [Single-language category editor, mobile](category-editor-mobile.png)
- [Single-language Terms editor, desktop](terms-editor-chromium.png)
- [Single-language Terms editor, mobile](terms-editor-mobile.png)

The route checks record no browser console, page, or failed-network errors. The unknown-product unlock case deliberately returns 404; canceled requests during successful client navigation are recorded with their URL, error, test title, and elapsed time.
