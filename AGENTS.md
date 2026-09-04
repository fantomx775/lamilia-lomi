<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Lamilia Lomi development workflow

This is a small side project. Optimize for fast iteration and use quality gates proportionally to risk.

## Normal PR / feature change

Default verification:

- lint
- typecheck
- unit/integration tests

Run `npm run build` when the change affects:

- routing,
- Server Components / Server Actions,
- environment/configuration,
- dependencies,
- backend integration,
- or before merging a substantial PR.

Run focused Playwright/E2E only for the user flow changed by the PR.

Do NOT run the full Playwright suite by default for every change.

## Full verification

Run the full E2E/browser suite only when:

- preparing a Production release,
- changing authentication/authorization/security boundaries,
- changing premium unlock/download behavior,
- making a broad cross-cutting change,
- or when focused tests indicate a possible regression outside the changed area.

## Vercel

Automatic Git deployments are intentionally disabled.

Vercel Preview is optional and must not be treated as a merge quality gate.

Create a Preview manually only when hosted-runtime behavior actually needs verification.

Production deploys always require explicit approval.

## Release gate

Before a real Production release run:

- lint
- typecheck
- tests
- build
- full relevant E2E
- production dependency audit
- real Supabase/runtime smoke for changed critical flows

Do not turn release-level verification into a mandatory gate for every development PR.
