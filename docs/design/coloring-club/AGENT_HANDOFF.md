# ADDENDUM TO OVERNIGHT CODEX PROMPT — VISUAL DESIGN REFERENCES

Before implementation of any UI in Coloring Club Epic #77, read:

- `docs/design/coloring-club/README.md`
- `docs/design/coloring-club/screenshots/gallery-desktop.png`
- `docs/design/coloring-club/screenshots/gallery-mobile.png`
- `docs/design/coloring-club/screenshots/artwork-detail-desktop.png`
- `docs/design/coloring-club/screenshots/artwork-detail-mobile.png`
- `docs/design/coloring-club/screenshots/my-creations-desktop.png`
- `docs/design/coloring-club/screenshots/my-creations-mobile.png`
- `docs/design/coloring-club/screenshots/upload-desktop.png`
- `docs/design/coloring-club/screenshots/upload-mobile.png`
- `docs/design/coloring-club/screenshots/moderation-desktop.png`
- `docs/design/coloring-club/screenshots/moderation-mobile.png`

The references are *composition/UX guidelines*, not a request to implement static HTML or hardcoded sample data. Reuse Lamilia Lomi's existing design tokens, shell, admin components and drawer animations; deliver functional responsive React/Next.js UI. The existing public storefront is EN-only and admin PL. Keep synthetic sample images out of production.

Required visual-review loop: after each new page, render in actual browser, screenshot at 390/768/1440, compare with appropriate reference, fix overflow/crowding/typography/status ambiguity/CTA issues, repeat. Use independent Luna reviewer for visual QA, and attach evidence to PR. Validate actual backend auth/RLS/business behavior separately.

The current EPIC/#78–#85 acceptance criteria remain authoritative over any visual reference.
