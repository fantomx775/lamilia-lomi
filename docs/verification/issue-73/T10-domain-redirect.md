# Issue #73 T10 — Production Vercel alias redirects

Checked 2026-10-25 against Vercel project `lamilia-lomi` (`prj_ktTjOHS0QW0pdfyhKaQs883MJvYd`, team `team_lS6KpgnOGBg7jJ1AKF0Z2QU4`). The active Production deployment was `dpl_G9L1u8b362fUXhCFKhNSZHsBLs4g`, from `main` SHA `a29bdcd94710d59bb38023d2d5a66becff4db6af`.

## Configuration

Before this task, `lamilia-lomi.vercel.app` was an existing verified project domain with no redirect and public `200` responses. The generated stable aliases `lamilia-lomi-fantomxs-projects.vercel.app` and `lamilia-lomi-git-main-fantomxs-projects.vercel.app` appeared on the project and the current Production deployment, but had no project-domain records; unauthenticated requests returned Vercel SSO `302` responses. Their project-domain GETs returned `404` before registration.

Added or updated only these three exact, project-owned host records. Each now has `redirect: www.lamilialomi.com`, `redirectStatusCode: 308`, and `verified: true`:

- `lamilia-lomi.vercel.app`
- `lamilia-lomi-fantomxs-projects.vercel.app`
- `lamilia-lomi-git-main-fantomxs-projects.vercel.app`

The native project-domain API accepted the generated stable aliases as redirects. No app routing fallback, wildcard, DNS edit, deployment-path change, or deployment-protection exception was needed. Project SSO remains enabled with `all_except_custom_domains`; the project’s protection settings were not changed. The apex domain’s existing `308` to `www.lamilialomi.com` remains configured.

## Public HTTPS responses

Direct, non-following GETs were made with `curl.exe` and `--max-redirs 0`:

| Host | Path | Status | Location |
| --- | --- | --- | --- |
| `lamilia-lomi.vercel.app` | `/` | `308` | `https://www.lamilialomi.com/` |
| `lamilia-lomi.vercel.app` | `/en/products/https-www-amazon-com-dp-b0h8jq467j?campaign=t10&view=compact` | `308` | Same canonical host, path, and query |
| `lamilia-lomi-fantomxs-projects.vercel.app` | `/` | `308` | `https://www.lamilialomi.com/` |
| `lamilia-lomi-fantomxs-projects.vercel.app` | `/en/products/https-www-amazon-com-dp-b0h8jq467j?campaign=t10&view=compact` | `308` | Same canonical host, path, and query |
| `lamilia-lomi-git-main-fantomxs-projects.vercel.app` | `/` | `308` | `https://www.lamilialomi.com/` |
| `lamilia-lomi-git-main-fantomxs-projects.vercel.app` | `/en/products/https-www-amazon-com-dp-b0h8jq467j?campaign=t10&view=compact` | `308` | Same canonical host, path, and query |
| `www.lamilialomi.com` | `/en/products/https-www-amazon-com-dp-b0h8jq467j?campaign=t10&view=compact` | `200` | No redirect |

Following the alias product URL reached the same canonical product URL with the query intact and returned `200` after one redirect. Following the alias root reached `https://www.lamilialomi.com/en` and returned `200` after two redirects; `www` itself did not redirect back to an alias. The canonical `www` root’s existing `307` to `/en` is the site’s locale behavior. The apex product URL was also observed redirecting directly to the canonical product URL and returning `200` after one redirect.

## Protection and Preview boundary

The current immutable Production URL `lamilia-lomi-czj5s4km1-fantomxs-projects.vercel.app` still returns Vercel SSO `302`, confirming the alias changes did not unprotect that deployment URL. Vercel reported zero READY Preview deployments during this check, so no live Preview URL was available to test. The three configured names are exact project-domain records; no `vercel.app` wildcard or Preview/deployment hostname was added. Preview live verification remains for the final candidate when a READY Preview is available.

The native project-domain approach is documented by Vercel under [Deploying & Redirecting Domains](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting). Vercel’s [Deployment Protection documentation](https://vercel.com/docs/deployment-protection) confirms that SSO protection is enforced before routing middleware; this change avoided changing that setting or making exceptions.
