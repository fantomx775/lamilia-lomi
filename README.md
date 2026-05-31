# LamiliaLomi

Next.js App Router implementation for the LamiliaLomi content platform described in:

- `LamiliaLomi_SOURCE_OF_TRUTH.md`
- `LamiliaLomi_IMPLEMENTATION_PLAN.md`

The app currently runs in local demo mode with deterministic seed data and Supabase-ready migrations. No real secrets are required to try the core flow.

## Getting Started

```bash
npm run dev
```

Open [http://127.0.0.1:3000/en](http://127.0.0.1:3000/en).

Demo accounts:

- User: `demo@lamilialomi.test`
- Unverified user: `unverified@lamilialomi.test`
- Admin: `admin@lamilialomi.test`

Premium code:

- `LOMI-BOOK-2026`

Useful commands:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e
```

## Supabase

The schema foundation is in:

- `supabase/migrations/20260531093244_lamilialomi_foundation.sql`

Apply it to the intended Supabase project, then set the values from `.env.example`.
