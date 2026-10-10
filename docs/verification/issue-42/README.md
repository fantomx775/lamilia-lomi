# English-only public site verification

Captured locally with the demo backend during serial Playwright run `issue-42-english-only-verified-20261010`. After the legacy-media filtering fixes, the English-only, single-language admin save/reload, and image-order flows passed again on desktop and mobile Chromium (6 focused browser cases).

The run covered desktop and mobile navigation, removal of the language selector, English-only page content, 308 redirects from legacy `/pl`, `/de`, and `/es` routes, QR unlock redirects, and saving/reloading product, category, and Terms content. The full Playwright result was 85 passed and 13 conditionally skipped.

## Screenshots

- [English home, desktop](english-home-desktop.png)
- [English home, mobile](english-home-mobile.png)
- [Single-language product editor, desktop](product-editor-chromium.png)
- [Single-language product editor, mobile](product-editor-mobile.png)
- [Single-language category editor, desktop](category-editor-chromium.png)
- [Single-language category editor, mobile](category-editor-mobile.png)
- [Single-language Terms editor, desktop](terms-editor-chromium.png)
- [Single-language Terms editor, mobile](terms-editor-mobile.png)
