# Admin CRUD Gap Audit

Date: 2026-05-31
Status: implemented for local demo/content-store mode

This audit records the CRUD gaps found in the admin area and how they were closed in the current slice.

## Key Findings

| Area | Gap found | Current implementation |
| --- | --- | --- |
| Products | Product list and editor were read-only demo screens backed by `seed-data`. The save button did not persist anything. | Product create/edit/archive/delete now goes through Server Actions and writes to `data/lamilialomi-content.local.json` in local demo mode. |
| Product translations | Editor only exposed EN/PL title and long description. DE/ES and SEO fields were missing. | Product editor now supports EN/PL/DE/ES title, short description, long description, SEO title, and SEO description. |
| Categories | Categories were list-only; no create, update, or delete. | `/admin/categories` now supports inline create/update/delete with EN/PL/DE/ES names and descriptions. Deleting detaches the category from products. |
| Tags | Tags were list-only; no create, update, or delete. | `/admin/tags` now supports inline create/update/delete with EN/PL/DE/ES names. Deleting detaches the tag from products. |
| Product-taxonomy assignment | Product editor did not assign categories or tags. | Product editor now has category/tag checkbox assignment. |
| Amazon links | Only one input existed, with no market or primary link management. | Product editor now supports multiple Amazon links, `amazon.com`/`amazon.de`, primary flag, and removal. |
| Premium codes | Only one code input existed; no active flag or multi-code management. | Product editor now supports multiple premium codes, active flag, and removal. |
| Public vs premium media | There was no clear admin place to decide what guests see versus what unlocked users get. | Product editor now separates asset kinds by rule: `cover`, `gallery`, `video`, and `public_download` are guest-visible/public; `premium_download` is private/premium. |
| Cover/video selection | Product model had `cover_asset_id` and `video_asset_id`, but editor did not clearly manage them. | Product editor now lets admin select cover and public video from product assets, with sensible fallback to first matching asset. |
| Static pages | Admin page editor displayed Privacy/Terms textareas without persistence. | `/admin/pages` now edits Privacy/Terms per EN/PL/DE/ES locale via Server Actions. |
| Public reads | Public catalog/product pages were hardwired to seed arrays. | Product, taxonomy, asset, and static-page reads now go through `content-store`, which falls back to seed data and uses local persisted content when present. |
| Storage buckets | Supabase config did not define the expected media buckets. | `supabase/config.toml` now declares `public-media`, `public-videos`, and private `premium-files` buckets for local Supabase. |

## Remaining Production Activation Notes

- The connected remote Supabase project currently reports no public tables, so the foundation migration still needs to be applied to the intended project before production data can live in Supabase.
- The current CRUD persistence is local demo persistence through `data/lamilialomi-content.local.json`; that file is ignored by git.
- Production Supabase CRUD should replace or extend this repository layer with Supabase reads/writes once Auth is fully switched from demo cookies to Supabase Auth sessions.
- Binary upload UI is not yet wired to Supabase Storage. Admin can register asset metadata/path now; actual upload should be the next storage slice.

## Verification

- `npm test` passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm run e2e` passed on desktop and mobile projects.
- Browser gut-check confirmed `/admin/products/new` renders the media/premium and taxonomy sections without console errors.
