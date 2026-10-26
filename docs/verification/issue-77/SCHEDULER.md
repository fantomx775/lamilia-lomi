# Private media cleanup scheduler

Part of #81, extended by #85's account/media lifecycle. The application owns a small service-only durable reservation queue; no extra queue service is introduced.

`GET /api/internal/community/cleanup` requires an exact bearer credential supplied by Vercel as `CRON_SECRET`. Missing/short configuration fails closed with 503; wrong/missing authorization returns401. Authentication is independent of cookies, community membership, public flags and upload flags. The token and storage keys are never returned or logged. Each authorized invocation attempts ten batches of up to ten backend-claimed cleanup records; a failed object removal retains durable work for a later invocation. An HTTP200 means the bounded maintenance pass ran, not that every queued object has been physically removed.

`vercel.json` adds a daily03:00UTC invocation, retaining the existing review-reminder cron and main-only Git deployment behavior. Daily scheduling is intentionally compatible with the Hobby plan. Request-driven immediate cleanup remains the fast path; the scheduler provides an independent later attempt if the user never returns. Lease/expiry details must match the final migration; do not claim a fixed cleanup deadline during provider outages.

Read-only Vercel metadata confirms a sensitive Production `CRON_SECRET` entry exists in the exact Lamilia project. Its value was not read or printed; effective runtime authentication remains to be verified before release. The local test launcher reads a disposable secret from a private file outside git. No cloud secret/configuration change has been performed at this checkpoint.

PASS: `npm test -- src/app/api/internal/community/cleanup/route.test.ts --maxWorkers=1` (7tests): unconfigured/wrong auth denied, bounded authenticated drain works with both feature flags OFF, backend failure is reported without disclosing details. Focused ESLint passes. Actual isolated HTTP auth plus a queued real-object deletion PASS in the six-test upload browser suite. Actual deployed cron configuration/execution remains NOT RUN release work.

Official behavior reference: [Vercel cron management/authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [cron usage/scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
