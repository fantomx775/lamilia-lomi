# Lamilia Lomi — Coloring Club P0 / UX mockup pack

**Design reference v1 · 25 October 2026**
**Target repo:** `fantomx775/lamilia-lomi`
**Epic:** [#77](https://github.com/fantomx775/lamilia-lomi/issues/77)
**P0 scope:** #78–#85
**Target implementation:** Next.js App Router + Supabase + existing project components

## What is in this package?

Ten PNGs with **five distinct states, each at desktop and mobile**, plus a static offline HTML/CSS prototype and demo illustration placeholders.

| View | Desktop | Mobile | Implementation issues | Essential pattern |
| --- | --- | --- | --- | --- |
| 01 Public Coloring Club | `screenshots/gallery-desktop.png` | `screenshots/gallery-mobile.png` | #83, #84 | Brand hero, book filters, cards, creator credit, hearts |
| 02 Artwork detail | `screenshots/artwork-detail-desktop.png` | `screenshots/artwork-detail-mobile.png` | #83, #84 | Large artwork, public creator, book context, like, related works |
| 03 My Creations | `screenshots/my-creations-desktop.png` | `screenshots/my-creations-mobile.png` | #80, #81 | User-owned gallery, status counts and author actions |
| 04 Upload | `screenshots/upload-desktop.png` | `screenshots/upload-mobile.png` | #81 | Desktop drawer, focused full-screen mobile form, limits and preview |
| 05 Admin moderation | `screenshots/moderation-desktop.png` | `screenshots/moderation-mobile.png` | #82, #85 | Queue + preview + approve/reject, PL UI, safe statuses |

Start with `preview-desktop.png` and `preview-mobile.png` for a quick overview. Full-resolution screenshots contain the actual design references.

**Prototype:** Open `prototype/gallery.html`, `prototype/artwork-detail.html`, `prototype/my-creations.html`, `prototype/upload.html` or `prototype/moderation.html` in a browser. These are **static visual prototypes**, not functioning API/React routes. Asset paths are relative; no external fonts/scripts/network needed.

## Authoritative product behavior

The screenshots are *visual references*. The approved decisions in Epic #77 and issues #78–#85 are **behavioral source of truth**.

1. Public viewing of **approved** artwork, including anonymous visitors.
2. Upload requires adult opt-in, verified account, and product-specific unlock for a **published** book.
3. Artwork is linked to a book (not to an individual coloring-book page).
4. Users can add multiple works, edit descriptions and delete their own. One artwork = one image; selecting up to 3 images creates 3 artworks, not one multi-image post.
5. Hearts only at MVP. **No comments, stars, user follows, public DMs, social posts or blog.**
6. Social profile has `@username`, generated avatar and **approved** works; no emails or private unlock details.
7. Kids safety: adult-operated accounts; no photos identifying children. Image moderation required before public display.
8. After an approved artwork's public description is edited, it returns to `pending` for moderation and must be inaccessible to strangers until re-approved.
9. Admin: preview, approve, reject with reason, remove published artwork, moderation audit trail and reports.
10. Existing admin-curated `product_reader_artworks` gallery from #73/#74/#75 is preserved and integrated with UGC into a **single** "Colored by Our Readers" section. Uncolored "Look Inside" gallery stays separate.

> **Do not infer functional requirements from purely visual decoration.** Mock images and names are fictional. Do not seed them into the production database. Frontend is currently English-only; admin in Polish, aligned with current `src/i18n/routing.ts`.

## Design system — based on actual repository CSS

From `src/app/globals.css` on `main` (verified 2026-10-25):

| Semantic token | HEX | Design role |
| --- | --- | --- |
| `--color-bg` | `#f9f6f1` | Warm cream page background |
| `--color-bg-alt` | `#f1eee8` | Light gray/cream surface |
| `--color-surface` | `#fefdfb` | Cards, controls |
| `--color-ink` | `#2e443a` | Primary text and primary actions |
| `--color-ink-soft` | `#25392f` | Dark hover |
| `--color-muted` | `#57534d` | Secondary text |
| `--color-border` | `#ddd6cc` | Dividers/borders |
| `--color-sage` | `#c8cdbf` | Subtle botanical accent |
| `--color-terracotta` | `#59425c` | Existing plum/terracotta semantic accent |
| `--color-blush` | `#ece8e1` | Warm muted background |

Additional **mockup-only** colors for feedback: rose `#b86f7d` for hearts, positive `#e7eee3` / green, pending `#fff2da` / amber, rejected `#f9e9e5` / muted red. Use existing design tokens/styles where possible and introduce the fewest new tokens necessary.

Typography: elegant serif heading paired with readable sans UI, similar to existing Lamilia Lomi. Static prototype uses local Georgia/Inter fallbacks. **Do not bundle or commit font files.**

## Layout & interaction guidelines

### Public Coloring Club (#83, #84)
- Photo-first grid. Desktop ≈4 columns on 1440 px; phone 2 columns on 390 px. Fine-tune breakpoints for content.
- Author avatar/name, title, book attribution and like count appear beneath or on a discreet image overlay. Do not bury work behind a giant UI card.
- Compact book/audience/sort controls with clear active state.
- Keep a readable page title and **one** prominent "Share your artwork" CTA.
- For anonymous users, CTA routes through existing login/unlock flow with a safe return path; never falsely suggests they can upload without unlocking the book.
- Screenshots show illustrative text and counts, **not real content**.

### Artwork detail (#83, #84)
- Large artwork takes visual priority; readable author, date, short description, book link, heart.
- Do not show "Follow" or social messaging features.
- Private/pending/removed paths return no public image bytes, even if URL was previously known; cache must honor takedown.

### My Creations & Upload (#81)
- Author sees `Published`, `Pending review`, `Rejected` and actionable rejected reasons.
- Desktop upload is a familiar right drawer with consistent app animation (reuse existing drawer convention).
- Mobile upload is a **focused, independent full-width flow**, not a desktop drawer squeezed to 390 px.
- File selection, real preview, per-file validation, progress/errors, retry and persisted status.
- Description edit and delete own artwork available from each card; admin status is never client-editable.

### Admin moderation (#82, #85)
- Polish labels and actions in existing `/admin` shell.
- Desktop: manageable queue + selected artwork + context + explicit approval/rejection actions.
- Mobile: horizontal queue selector, then **one scrolling page** of selected artwork and actions; avoid scroll-inside-scroll.
- Reject must collect a reason; include removal and report-review flows even though not shown in this single screenshot.
- Approve/reject must be race-safe, audited, authorized server-side.

## Implementation instructions for Codex

1. **Read this document, all ten screenshots, and the affected issues before editing UI.** For each screen, identify existing components to reuse. In particular, inspect `src/components/reader-artwork-gallery.tsx`, `src/components/product-image-gallery.tsx`, account dashboard, admin UI, and `src/app/globals.css`.
2. Prefer the **actual repository design tokens and components** over copying static prototype markup verbatim. The HTML prototype exists only to make composition and spacing inspectable.
3. Implement backend authorization/status semantics strictly from issues #78–#85, not from hardcoded demo strings.
4. Check 390 / 768 / 1440 widths, no horizontal overflow, no nested scrolling in mobile moderation, keyboard/focus, contrast, and reduced-motion.
5. Use Playwright to capture rendered application screenshots for every P0 screen. Compare actual composition, image ratio, typography, density, spacing, borders, CTA prominence, empty/error/loading states against these PNGs.
6. Correct visible differences after independent UI review. Pixel-perfect identity is **not** a gate; responsive quality, clarity and consistency are.
7. Keep existing reader-artwork admin gallery and public product gallery operational.
8. Respect privacy/RLS/media access security: visuals cannot override those constraints.
9. Screenshots are generated synthetic visual references, not proof that any user behavior or browser E2E has been implemented.

### Proposed final QA

- One or more browser flows for logged-out visitor, locked user, unlocked user, admin; include negative unauthorized media access.
- Compare screenshot compositions at 390/768/1440 for every new route.
- Test actual upload, moderation, hearts, edit/removal, errors and reload persistence.
- Re-run existing premium unlock, catalog, and reader-artwork gallery regressions.
- Verify real Supabase RLS/storage constraints and migrations before deployment.

## Files & provenance

- `screenshots/` — final references (10 PNGs).
- `preview-desktop.png`, `preview-mobile.png` — contact sheets.
- `prototype/` — HTML/CSS static layout; no backend logic and no React.
- `assets/` — *synthetic sample artworks*, extracted from AI-generated concept imagery and used solely in mockups. They are placeholders and should not be copied into the live user gallery.
- `AGENT_HANDOFF.md` — concise addition to the overnight orchestration prompt.

**This package has not been added to GitHub or deployed.** It is intended to be placed in `docs/design/coloring-club/` inside the repository and committed along with #78, if desired.
