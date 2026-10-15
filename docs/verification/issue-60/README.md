# Issue 60 — Product detail polish

The PDP keeps the complete product title, metadata, description and purchase/unlock destinations. The hero now presents the short description and actions before a six-line long-description preview. The measured disclosure animates for 200 ms, disables that transition for reduced motion, and prevents clipped links from receiving focus. Short descriptions have no disclosure control.

The gallery presents four uncropped portrait pages, with a remaining-page count on the fourth thumbnail. Its existing native dialog now fits the page, restores the opening control's focus, wraps keyboard focus, and retains arrow, Escape and mobile swipe controls. Video remains separate from the four picture slots and uses contain sizing. Route placeholders mirror the cover, actions, text, four-page gallery, video and premium-access area without changing the Suspense boundaries.

## Browser evidence

- `before-desktop.png` and `before-mobile.png`: the public Production Frog Prince page before this change; these are comparison material, not candidate verification.
- `initial-{chromium,mobile}.png`: local PDP using the public Frog Prince title, descriptions and original media.
- `expanded-{chromium,mobile}.png`: complete description revealed.
- `gallery-{chromium,mobile}.png`: curated preview, separate video and correct `+1 more` count.
- `lightbox-{chromium,mobile}.png`: fifth page available without cropping.
- `loading-{chromium,mobile}.png`: actual pending route, captured using the existing local delay hook.

Chromium uses 1440 × 900; mobile uses the Playwright Pixel 7 device profile. Screenshots were inspected visually and the title scale, description fade and dialog width were refined after inspection. Exact final head SHA, run ID, screenshot provenance, diagnostics, checks and independent review are recorded in the PR evidence comments.

The focused E2E also checks short/empty descriptions, 0/1/4/5 gallery images, rich headings/lists/links, reduced motion, image dimensions, dialog focus and wraparound, touch controls, actual video playback, the premium section and Amazon href. Existing gallery, legacy QR and verified-owner Library/download checks provide focused regression coverage.

## Local runtime boundaries

The supported local demo backend was used. Production-mode compilation is checked separately because the application deliberately disallows running the local backend in Production mode. No hosted Preview is needed for this UI change.

The browser test downloads the unchanged public source media to the ignored `public/uploads/issue-60-browser/` directory and runs the real local Next image optimizer. This avoids the Windows upstream optimizer's seven-second download deadline for multi-megabyte CDN originals. The public fixture retains the original source URLs. The local demo locale middleware redirects static MP4 paths, so the same original movie is streamed by a temporary loopback server with HTTP range support. Playback is verified in Chromium and Pixel 7; no media HTTP responses are mocked. The temporary server closes and the disposable content snapshot is restored after every test.

Cancelled navigation/prefetch requests and cancelled video buffer/range requests are recorded separately from HTTP failures. The final passing run requires no console/page errors, no HTTP 4xx/5xx, loaded images and successful video playback. These local checks do not claim new Production or Supabase authorization coverage. No schemas, published records, CDN settings, dependencies or Production deployment are changed.

## Verification commands

```text
git diff --check
node node_modules/eslint/bin/eslint.js <changed TS/TSX files>
node node_modules/vitest/vitest.mjs run src/components/product-description.test.tsx src/components/product-image-gallery.test.tsx src/components/product-video-preview.test.tsx src/lib/public-product-detail.test.ts --pool=forks --maxWorkers=1
npm run build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3060 node node_modules/@playwright/test/cli.js test tests/e2e/issue-60-pdp.spec.ts --workers=1 --reporter=line
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3060 node node_modules/@playwright/test/cli.js test tests/e2e/product-gallery.spec.ts tests/e2e/unlock-funnel.spec.ts --grep "gallery opens|legacy QR links|verified owner reaches Library" --workers=1 --reporter=line
```

GitHub CI is the authoritative final broad gate for typecheck, full lint, unit tests and the Production build. This PR is for review only: Issue 60 stays open, with no merge or Production deployment.

## Final accessibility fix and delivery candidate

The visible collapsed preview is now an escaped, extracted text excerpt (up to 180 characters), separate from the hidden inert rich-text subtree. The accessible preview container has no inert/aria-hidden. Expanding exposes the original full rich content, including headings, lists and links. Short descriptions stay fully visible with no toggle. A measured explicit height preserves the 200ms expand/collapse transition and reduced-motion override. Before hydration the component renders unrestricted full content.

A real JavaScript-disabled browser uncovered a pre-existing Next streaming limitation: the route's loading boundary stays visible without scripts. The loading fallback now server-renders a noscript reading link, using the router slug, to `/api/product-description/[slug]`. This read-only public endpoint returns the entire title, short description and extracted long description as non-executable UTF-8 plain text, without truncation, cookies, private assets or mutations. It uses the same published-product lookup as the PDP. Rich formatting and actionable rich links remain in the normal expanded view; the no-JS fallback is a complete plain-text reading view.

Focused tests include collapsed/expanded accessibility, keyboard disclosure, inert rich content, short/empty content, static SSR, escaping, the fallback link and public-only text response. Browser regression uses a real JS-disabled context and follows the fallback, checks the final original paragraph, real Tab/Enter, reduced motion, rich formatting/link, 0/1/4/5 images, lightbox focus/keys/touch, actual video playback, Amazon destination and guest premium entry. Screenshots are under `final/`; current-SHA run provenance is recorded on PR #61.

Screenshot capture uses `caret: initial` to avoid Playwright temporarily adding caret-color attributes to not-yet-hydrated streaming form inputs. An earlier run detected that screenshot-induced hydration warning; final checks require zero browser console/page/HTTP errors.

Production delivery is now explicitly authorized by the owner. No database migration, Cloudflare change, dependency change, published-product mutation or real premium redemption is included.
