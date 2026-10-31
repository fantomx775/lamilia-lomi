# Real isolated Coloring Club regression tests

Issue [#97](https://github.com/fantomx775/lamilia-lomi/issues/97), part of
[#77](https://github.com/fantomx775/lamilia-lomi/issues/77).

These fixtures create accounts, products and private Storage objects and delete
only their controlled resources. They must never use a hosted database or
Production account, code, object or environment file. Local/mock tests, real
local Supabase tests, hosted verification and Production feature-OFF checks are
separate evidence categories.

## Target selection and refusal checks

Set `COMMUNITY_SUPABASE_STATUS_PATH` to an absolute private JSON status file and
`COMMUNITY_SUPABASE_PROJECT_ID` to the exclusive local Supabase project slug.
The historical Linux defaults remain supported, but are unnecessary on a fresh
machine. `COMMUNITY_TEST_ORIGIN` optionally selects
`https://localhost:3443`; its default is `https://127.0.0.1:3443`.
Maintenance browser tests also use `COMMUNITY_CRON_SECRET_PATH`, an absolute
path to the exclusive local application's private maintenance secret file.
The loader trims the file and requires at least 32 non-whitespace characters;
it never logs the bearer or underlying file errors. Its historical `/tmp`
path remains a compatibility default. Configure the application process's
`CRON_SECRET` from that same owned file; never use a Production bearer.

Before any Auth, Storage or SQL fixture write, the shared loader verifies:

- API exactly `http://127.0.0.1:55421` and nonempty local anon/service keys.
- Database URL uses loopback port `55422` and database `postgres`.
- Project slug contains only lowercase letters, digits, `_` and `-`.
- Both the database and Kong gateway are running, carry the matching Supabase
  CLI and Docker Compose project labels, and share that project's network.
- Those containers publish the expected database/API ports on IPv4 loopback
  (`127.0.0.1`) or its wildcard (`0.0.0.0`). A matching port published only on
  another interface or IPv6 is insufficient for the fixed IPv4 API target.
- `DOCKER_HOST`, when present, and the selected Docker context use a local
  named pipe or Unix socket. TCP, SSH and HTTP daemon endpoints are refused,
  including TCP loopback endpoints which may be forwarded elsewhere.

SQL fixture operations use the verified database's immutable Docker ID, so a
later container-name reuse cannot redirect cleanup into another database.
Their subprocesses also pin the verified local daemon endpoint, overriding
later changes to the active Docker context.
Docker inspection requests only identity, labels, networks and published ports;
credentials are neither printed nor passed as subprocess arguments.

## Create an exclusive local backend

Run `worktree-preflight` before dependencies or application validation. Follow
the repository's normal dependency setup; do not share writable `node_modules`
or `.next` with another worktree.

Use a new directory under the machine's temporary directory. Do not repoint an
existing shared stack. For example, in PowerShell:

```powershell
$localProject = 'lomi-stabilize-20261031'
$localRoot = Join-Path $env:TEMP $localProject
if (Test-Path -LiteralPath $localRoot) { throw 'Choose a new exclusive test directory.' }
New-Item -ItemType Directory -Path $localRoot | Out-Null
supabase init --workdir $localRoot --yes
```

Configure **that temporary** `supabase/config.toml` with its project ID, API
`55421`, DB `55422`, shadow DB `55420`, mail sink `55424` and disabled optional
Studio, analytics, realtime and edge-runtime services. Set the Auth site URL to
the selected local HTTPS application origin and allow its `/**` callback URLs.
Enable email confirmations for genuine confirmation journeys. Copy the
repository's `supabase/templates/confirmation.html` and configure the local
confirmation template; default GoTrue templates do not exercise the
application's token-hash callback/resume flow. Keep outbound email directed to
the local mail sink.

Check free ports and available memory first. Start only this project; quote the
comma-separated exclusions in PowerShell so they are passed as one argument:

```powershell
supabase start --workdir $localRoot --exclude 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor' > "$localRoot\start-private.log" 2>&1
```

Keep startup/status logs private: CLI output may contain synthetic local keys.
If a CLI version starts optional services anyway, inspect their exact project
labels and stop only that exclusive project's unnecessary containers. Never
stop or reset another repository's stack.

Start a blank local database without application migrations first. Historical
Storage policy SQL requires ownership unavailable to the normal local
`postgres` migration role. The established local workaround is to execute the
unchanged application migrations in filename order, each in a transaction,
inside `supabase_db_<project>` using `psql -U supabase_admin -d postgres
-v ON_ERROR_STOP=1`. Record each successfully applied version/name in the
local `supabase_migrations.schema_migrations` ledger. Apply the unchanged
`supabase/seed.sql`, install pgTAP in `extensions`, and record migration IDs and
results. Do not edit historical SQL or use this local superuser workaround on
Production. See [the prior bootstrap evidence](verification/issue-77/PREFLIGHT.md)
and [Storage ownership explanation](verification/issue-49/supabase-local.md).

Save status without displaying its contents:

```powershell
supabase status --workdir $localRoot -o json > "$localRoot\status-private.json" 2> "$localRoot\status-stderr.log"
$env:COMMUNITY_SUPABASE_STATUS_PATH = Join-Path $localRoot 'status-private.json'
$env:COMMUNITY_SUPABASE_PROJECT_ID = $localProject
$env:COMMUNITY_TEST_ORIGIN = 'https://localhost:3443'
$env:COMMUNITY_CRON_SECRET_PATH = Join-Path $localRoot 'community-cron-secret'
```

The status file must include `API_URL`, `DB_URL`, `ANON_KEY` and
`SERVICE_ROLE_KEY`. Load needed keys only into the test application's process
environment. Do not print, commit, or copy a Production environment file.
Confirm Auth health, REST and private Storage API connectivity without logging
response bodies or credentials. A healthy endpoint alone does not prove a
fixture journey passed.

## Execute and report

The shared `.mjs` helper stays native ESM for Node, Python and Playwright.
`playwright.config.ts` excludes only that exact test-helper path from its
transpilation. In a CommonJS test package, Playwright's require hook otherwise
emits `exports` inside the ESM module and collection fails before any fixture
runs. A nested `type: module` package alone does not correct that hook.

Use collection as the quick module-boundary regression check; it starts no
application or fixture:

```powershell
npm run e2e -- tests/e2e/community- --project=chromium --list
```

The 2026-10-31 repair collected all 16 Chromium cases across eight community
specs. This is collection proof, not 16 executed browser passes. The focused
helper suite separately passed 63 assertions, while native Node CLI and the
Python bridge returned only safe verified Docker metadata without running SQL.

The pure target/refusal tests do not contact Docker or Supabase:

```powershell
node node_modules/vitest/vitest.mjs run scripts/testing/isolated-community-target.test.mjs --maxWorkers=1 --pool=forks
```

The integration suite opts in explicitly and validates Docker identity before
creating its own controlled resources:

```powershell
$env:RUN_COMMUNITY_SUPABASE_TESTS = '1'
node node_modules/vitest/vitest.mjs run src/lib/community/supabase.integration.test.ts --maxWorkers=1 --pool=forks
```

The coordinated PostgreSQL concurrency runner uses the same Node loader. It
receives only verified safe Docker metadata (local daemon endpoint, executable
and immutable database container ID), never status contents or keys. It does
not accept a container argument or implement a separate Python target policy.
With the same private status-path/project environment already set, run:

```powershell
python -X utf8 supabase/tests/community-hearts-concurrency.py
```

The normal command executes all four existing fixed-order scenarios:
heart/profile suspension, heart/Auth deletion, approval/profile suspension and
approval/Auth deletion. The historical `--reproduce-old-order` diagnostic
remains diagnostic-only and is never release acceptance.

For browser runs, start the application at the selected local HTTPS origin with
`LAMILIA_BACKEND=supabase` and only the isolated status credentials. For an
enabled community acceptance environment, set both Coloring Club flags to true
**only in that disposable application's process**. Test feature-OFF behavior in
a separate invocation. Never change the Vercel/Production flags for this suite.
Set `PLAYWRIGHT_BASE_URL` to the same `COMMUNITY_TEST_ORIGIN`, opt in to each
specific suite with its existing `RUN_COMMUNITY_*_E2E=1` variable, then run the
chosen spec with `--workers=1`. Use `COMMUNITY_ARTIFACT_DIR` to keep fresh
exact-SHA artifacts separate from historical captures.

Report actual command, head SHA, role matrix, cleanup result and PASS/FAIL/SKIP
counts. Do not count an opt-in skip or mock as real infrastructure acceptance.
Keep the exclusive backend available while review/testing needs it; after the
campaign, inspect exact container/project ownership before stopping its
services. A PR alone is not permission to remove an active validation backend.
