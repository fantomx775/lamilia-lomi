# LamiliaLomi

Next.js App Router implementation for the LamiliaLomi content platform described in:

- `LamiliaLomi_SOURCE_OF_TRUTH.md`
- `LamiliaLomi_IMPLEMENTATION_PLAN.md`

The app supports two explicit backend modes. Local demo mode uses deterministic seed data and the ignored JSON adapter; production mode uses Supabase Auth, Postgres, RLS, and private Storage. There is no automatic fallback between them.

## Configuration

Copy `.env.example` and choose the backend explicitly. Local development and the local E2E harness use `LAMILIA_BACKEND=local`. A production or Supabase build must use `LAMILIA_BACKEND=supabase`, a configured absolute `NEXT_PUBLIC_APP_URL` with an HTTPS origin, and the required Supabase variables. Missing, malformed, or unsafe values fail closed with a configuration error; request `Host` or forwarded headers never determine redirect origins.

For a production-style local build, set the variables in the shell before running `npm run build`; the build does not silently select local mode. Keep `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`) server-only; never put either key in client-exposed variables.

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
- `supabase/migrations/20260904120000_require_verified_premium_downloads.sql`
- `supabase/seed.sql`

Apply migrations and the seed/import only through the intended Supabase project workflow, then set `LAMILIA_BACKEND=supabase`, `NEXT_PUBLIC_APP_URL` to the deployed HTTPS origin, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY` (the legacy `SUPABASE_SERVICE_ROLE_KEY` remains supported during key migration). The verified-download follow-up migration is forward-only and must be reviewed/applied in the intended non-Production workflow; it was not applied to Production by this change. Promote an Auth user to admin by updating its `public.profiles.role` through an owner-controlled migration or SQL session; client-provided role/email values are never trusted.

The atomic server contract is `redeem_premium_code(product_id, code)`. It returns `success`, `already_unlocked`, `invalid_code`, `inactive_code`, `wrong_product`, `product_not_found`, `auth_required`, or `email_unverified`. Redemption and private Storage authorization both require the product to remain published; client-provided user IDs, product visibility, and stable private URLs are not authorities. Premium download routes use the verified Supabase user, RLS-filtered asset metadata, private Storage signed URLs, and `record_download_event`.

For a disposable local Supabase/Postgres database after applying the migrations and seed, run the reviewable RLS matrix with `psql -v ON_ERROR_STOP=1 -f supabase/tests/production-foundation-rls.sql`. The harness creates deterministic auth/storage fixtures, exercises anon/user/admin visibility and mutation boundaries plus verified/unverified unlock/download authorization, and removes those fixtures when it finishes. It is not a production data script.

Premium delivery requires an authenticated user whose current Auth record has a verified email, a matching unlock, a published product, and an active private premium asset. Local delivery uses a short-lived HMAC URL and rechecks the session, product, unlock, and asset on every request; missing, expired, or forged `token`/`expires` values are rejected. Supabase downloads use private Storage signed URLs and the same server-side checks.
