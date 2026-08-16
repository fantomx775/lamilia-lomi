# LamiliaLomi

Next.js App Router implementation for the LamiliaLomi content platform described in:

- `LamiliaLomi_SOURCE_OF_TRUTH.md`
- `LamiliaLomi_IMPLEMENTATION_PLAN.md`

The app supports two explicit backend modes. Local demo mode uses deterministic seed data and the ignored JSON adapter; production mode uses Supabase Auth, Postgres, RLS, and private Storage. There is no automatic fallback between them.

## Getting Started

```bash
$env:LAMILIA_BACKEND = "local"
npm run dev
```

Open [http://127.0.0.1:3000/en](http://127.0.0.1:3000/en).

Demo accounts:

- User: `demo@lamilialomi.test`
- Unverified user: `unverified@lamilialomi.test`
- Admin: `admin@lamilialomi.test`

Premium code:

- `LOMI-BOOK-2026`

Admin CRUD:

- Log in as `admin@lamilialomi.test`, then open `/admin`.
- In local mode, product, category, tag, static-page, media metadata, Amazon-link, and premium-code edits persist to `data/lamilialomi-content.local.json`.
- In Supabase mode, these paths read/write the Supabase schema through the server repository; missing Supabase configuration is a controlled configuration failure.

Useful commands:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e
```

## Supabase

The schema and deterministic import are in:

- `supabase/migrations/20260531093244_lamilialomi_foundation.sql`
- `supabase/migrations/20260815120000_supabase_production_foundation.sql`
- `supabase/seed.sql`

Apply migrations and the seed/import only through the intended Supabase project workflow, then set `LAMILIA_BACKEND=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`. Promote an Auth user to admin by updating its `public.profiles.role` through an owner-controlled migration or SQL session; client-provided role/email values are never trusted.

The atomic server contract is `redeem_premium_code(product_id, code)`. It returns `success`, `already_unlocked`, `invalid_code`, `inactive_code`, `wrong_product`, `product_not_found`, `auth_required`, or `email_unverified`. Redemption and private Storage authorization both require the product to remain published; client-provided user IDs, product visibility, and stable private URLs are not authorities. Premium download routes use the verified Supabase user, RLS-filtered asset metadata, private Storage signed URLs, and `record_download_event`.

For a disposable local Supabase/Postgres database after applying the migrations and seed, run the reviewable RLS matrix with `psql -v ON_ERROR_STOP=1 -f supabase/tests/production-foundation-rls.sql`. The harness creates deterministic auth/storage fixtures, exercises anon/user/admin visibility and mutation boundaries plus unlock/download authorization, and removes those fixtures when it finishes. It is not a production data script.
