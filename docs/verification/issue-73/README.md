# Issue 73 UI and release evidence

The PR verification record provides the exact tested SHA, browser run ID, commands, results and independent review. The committed screenshots show the rendered application with owned local fixtures at 390, 768 and 1440 CSS pixels. Book selections and artwork credits in these fixtures are test data. Production keeps its configured favorites.

## Reference and baseline

- [Owner-supplied About target](reference-about-target.png)
- [About before, desktop](before-about-1440.png) and [mobile](before-about-390.png)
- [Lightbox before, desktop](before-lightbox-1440.png), [tablet](before-lightbox-768.png) and [mobile](before-lightbox-390.png)
- [Owner-supplied premium input](reference-before-premium-code.png) and [product table](reference-before-admin-products.png)

The Production baseline captures precede this release. The supplied reference is used to compare composition; configured titles and cover images remain dynamic.

## About comparison

[Desktop](about-desktop.png), [tablet](about-tablet-768.png), [mobile](about-mobile.png).

The desktop uses two compact horizontal bands, each with section copy and three book cards, a serif heading with terracotta emphasis, botanical accents and Amazon actions. The intentional intro becomes the supporting tagline. At tablet width the section copy sits above the cards; at 390 pixels the cards use two columns. The existing shared site footer remains in place.

The browser scenario saves six distinct configured favorites, checks the corresponding titles and Amazon destinations, reloads them, and exercises unavailable/unpublished favorites. An empty group retains a clear empty state. It also checks overflow, loaded images and browser diagnostics.

## Product galleries and lightbox

- Four thumbnails without a video: [1440](gallery-four-1440.png), [768](gallery-four-768.png), [390](gallery-four-390.png).
- Two-column thumbnails beside a native video poster: [1440](gallery-with-video-1440.png), [390](gallery-with-video-390.png).
- Portrait lightbox with external navigation: [1440](portrait-lightbox-1440.png), [768](portrait-lightbox-768.png), [390](portrait-lightbox-390.png).
- Separate attributed reader gallery: [1440](reader-gallery-1440.png), [768](reader-gallery-768.png), [390](reader-gallery-390.png).
- Maximum-length nickname stress case: [1440](long-caption-reader-lightbox-1440.png), [768](long-caption-reader-lightbox-768.png), [390](long-caption-reader-lightbox-390.png).

These fixtures use existing repository illustrations, plus three images uploaded through the normal administrator API. The video layout capture uses the existing public flipthrough fixture and its native poster; playback has its own E2E scenario. The portrait scenario checks image containment, separate arrow gutters, keyboard navigation and focus restoration. The separate reader regression covers administrator mutations, public denial, reload persistence and preservation of the original gallery.

## Administration and premium input

- Single-column product editor: [1440](product-editor-1440.png), [768](product-editor-768.png), [390](product-editor-390.png).
- Reader management: [1440](reader-admin-1440.png), [768](reader-admin-768.png), [390](reader-admin-390.png).
- [Confirmed product-save toast](product-confirmed-toast-desktop.png).
- Terms: [dirty save bar](terms-dirty-savebar-1440.png), [confirmed save](terms-confirmed-toast-1440.png).
- Privacy: [dirty save bar](privacy-dirty-savebar-390.png), [confirmed save](privacy-confirmed-toast-390.png).
- Guest premium input: [1440](guest-neutral-premium-code-1440.png), [390](guest-neutral-premium-code-390.png).
- Long product titles and status badges: [390](products-390.png), [1280](products-1280.png), [1440](products-1440.png).

Successful-save screenshots follow confirmed server persistence. The failure regression separately verifies retained drafts and the dirty navigation guard. Test cleanup deletes only owned uploaded artworks and restores its original content snapshot byte for byte. Known browser request cancellations are retained with their specific cause in the browser record.

## Migration and deployment order

The additive migration is `20261024215218_reader_artworks.sql`, SHA-256 `19A5EE7638907FE075B834D8B0929CEE39B093025CAA93BA04A7FAC1496A578A`.

It creates a separate service-only artwork table and an invoker reorder function, enables RLS, restricts parent deletion while artwork metadata remains, and limits images to 4 MiB. Local SQL validation includes pgTAP and actual-role access checks. Existing product-asset kinds and the atomic product-save RPC retain their contracts.

Release order: final tests and independent review; confirm the linked Lamilia Lomi project `ebyhoawczbexwtioywuk`, migration history and exact pending SQL; apply and verify the compatible migration; verify the candidate Preview; use `deliver-pr` for the normal main merge and Vercel Git deployment; then verify the exact merge deployment, canonical domain, critical runtime flows, migration ledger/effects and owned-fixture cleanup. Actual migration/deployment outcomes are recorded in the PR release evidence.

See [stable Production alias redirects](T10-domain-redirect.md) for the domain configuration and its independent HTTP checks.
