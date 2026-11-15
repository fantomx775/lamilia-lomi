# Favicon browser verification

- Pull request: #116
- Tested source SHA: `ab40e6fc9b74d7243c3b725e46febd08f329d55d`
- Browser run ID: `pr-116-favicon-1794236398019`
- Route: `http://127.0.0.1:3101/en` on this worktree with the isolated local backend
- Page: HTTP 200, title `LamiliaLomi`, JavaScript errors: 0

## Icon requests

- PASS — icon 48x48: HTTP 200, image/x-icon, 5916 bytes
- PASS — icon 16x16: HTTP 200, image/png, 813 bytes
- PASS — icon 32x32: HTTP 200, image/png, 1907 bytes
- PASS — icon 48x48: HTTP 200, image/png, 3228 bytes
- PASS — icon 192x192: HTTP 200, image/png, 20483 bytes
- PASS — icon 512x512: HTTP 200, image/png, 119119 bytes
- PASS — apple-touch-icon 180x180: HTTP 200, image/png, 12508 bytes

Screenshot: [favicon-set.png](./favicon-set.png). It shows the exact image responses served by the candidate.
