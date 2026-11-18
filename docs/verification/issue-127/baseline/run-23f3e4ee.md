# Actual baseline production benchmark

Run `ux127-baseline-79df809-23f3e4ee`, 2026-11-18 06:04:16–06:08:27 UTC.
Application: `79df809db41ca824913719e91eaea4c5a3132fb4`, independent clean
baseline worktree, BUILD_ID `2RSz4aI_0ickjnVJWPIYO`. Driver source:
`ad7c3ecf554bcd718d135b70b2838ff0f027553e`; exact driver/spec/config/helper
hashes are in `run-23f3e4ee-driver-hashes-companion.json`.

**Actual result: 3 PASS / 3 FAIL / 0 SKIP.** Product desktop/mobile and About
mobile passed. Catalog desktop/mobile and About desktop failed strict network
checks. All 36 cold/warm observations reached the instrumented completion
condition. This does not turn the failed cases into passing evidence.

The six `samples-*.json` files retain the actual observations and unresolved
network diagnostics. The safe terminal summary retains 16 unresolved records
across the round diagnostics: five image failures for the local
`mindful-mandalas.svg` cover and eleven script failures. Recorded phase is
`source`; their exact cause was not established. No exception was added.

Execution used the isolated local Supabase, `next start` through the owned
HTTPS loopback proxy, Node 22.15.0 and Chromium 148.0.7778.96. Three cold/warm
pairs cover Catalog, Product and About in desktop Chromium and Pixel 7 viewport
emulation. CDP network conditions: 120 ms latency, 10 Mbps download, 1 Mbps
upload. The controlled pointer press lasts 50 ms; this is not physical touch.

Cold means a fresh browser context with normal prefetch allowed. Warm repeats
within the same context after full document navigation, retaining browser HTTP
cache; no router-cache claim is made. Feedback, fallback, useful content and
completion are separate signals. Completion means the destination heading is
paint-stable for two frames without a route fallback or `aria-busy`, rather
than completion of every media request. Feedback was observed in 12/36 and
fallback in 23/36 observations. A null signal means it was not observed, and
must never be treated as zero milliseconds. These laboratory observations are
not field CWV or a service-level guarantee.

The two inventory artifacts show the same representative read-model
fingerprint before and after: four seed products, no temporary products,
actors, artworks or Storage objects. Their scope is explicitly narrower than
the whole database. Owned servers/processes terminated and app ports were
released. Original overwritten integration-worktree artifact bytes were
archived privately before this evidence refresh; the primary checkout was
untouched.

The actual invocation was `node .task/ux127/run-production-benchmark.mjs
baseline`, which launched `node node_modules/playwright/cli.js test --config
playwright.ux127-benchmark.config.ts --workers=1 --reporter=line,json` with the
guarded isolated environment. Candidate comparison must use the same recorded
spec/config/helper hashes and representative inventory, and report these
baseline failures separately from any candidate failure.
