# Shared premium codes for Amazon KDP

## Behavior and compatibility

Each product can have one permanent `shared` code. Different verified accounts
can redeem it without a limit or expiry; the existing unique user/product
entitlement makes repeat scans idempotent. Historical codes default to
`single_use`, and historical entitlements are unchanged. Disabling a shared
code stops new grants and preserves grants already issued. Product saves cannot
rotate or remove the separately managed print code.

New QR payloads use the canonical site, a product UUID and URL fragment
parameters (`#productId=…&code=…`). The standalone entry document removes the
fragment before submitting the code in a same-origin POST. It has no analytics,
a restrictive CSP and no-referrer/no-store headers. Fragments do not reach HTTP
access logs. Older query-string QR links remain compatible, but their first
request necessarily exposes their query to upstream infrastructure; the app
cannot retroactively redact provider access logs. Never print new query-string
code links.

Historical slug aliases preserve current slugs and future changes. Slugs changed
before the alias migration cannot be recovered without a historical record.
UUID-based printed links do not depend on the title or slug. Login, signup and
confirmed-email callbacks resume the pending code; encrypted callback intents
also work in another browser after a successful Auth exchange proves the bound
account's email.

## Print placement

SVG and PDF are vector labels for placement in a book manuscript, rather than
complete KDP manuscript PDFs. They use black modules on an opaque white
background, Q error correction, a four-module quiet zone, at least 50 mm QR
size and at least 0.5 mm per module. The manual code remains at least 7 pt.
Glyph outlines preserve the printed label without an external font dependency.
Print/place at 100%; do not crop the white quiet zone, recolor the modules, or
place the label over the gutter, bleed or trim. Keep it inside the safe margins
for the manuscript's trim size and page count.

Amazon requires appropriate manuscript dimensions, safe margins and readable
text. See [Save Your Manuscript File](https://kdp.amazon.com/en_US/help/topic/G202145060)
and [Set Trim Size, Bleed, and Margins](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6).
Digital render/decode verification is recorded below; final manuscript placement
and a physical KDP proof copy remain the publisher's pre-print check.

## Release order and rollback

1. Validate additive migration `20261106140824` on an isolated local Supabase.
2. Pass focused tests, relevant browser/security E2E, production dependency
   audit, exact-candidate CI and independent review.
3. Apply and verify only this compatible migration on Production project
   `ebyhoawczbexwtioywuk`, before merging application code.
4. Use the repository delivery gate to merge the verified PR. Vercel's Git
   integration is the sole Production deployment path.
5. Confirm the exact merged SHA is READY; run Production schema, admin QR,
   two-account redemption, idempotency, authorization and download smoke, then
   inspect Vercel/Supabase errors.

If application deployment fails, stop delivery and restore the previous known
working application through the approved Vercel rollback path. Keep the additive
schema, aliases, codes and entitlements; do not reverse the migration by deleting
access data. Older application code remains compatible with this schema.

## Evidence

Implementation and verification are in progress. Production has not yet been
changed by this task. The release report and exact-SHA PR evidence will record
actual results, including any failed or unexecuted gate.

### Digital print validation

PASS: `docs/verification/kdp-shared/print-proof/digital-qa.json` records six
independent zxing-cpp decode checks: SVG and PDF rasterized at 150 and 300 dpi,
plus both 300 dpi images with 0.8-pixel Gaussian blur. Every decoded payload
matches the expected stable UUID/fragment URL. The fixture uses a fake code.
SVG was rasterized with sharp at explicit physical pixel dimensions; PDF with
`pdftoppm -r 150|300 -png -singlefile`. The 300 dpi PDF image was visually
inspected: QR, manual code and caption are readable with no clipping.

The sample label is 70 x 82 mm; its QR including the four-module quiet zone is
50 mm (61 modules, approximately 0.82 mm/module). Exports use opaque white
backgrounds and black vectors. All caption/manual-code glyphs are converted to
outlines using the bundled OFL-licensed Noto Sans Mono font, so no font program
needs embedding by the book-layout application. Text sizing never drops below
7 pt; the label grows if a longer code needs more room. The generator route
explicitly traces the font asset into the deployed function.

Physical KDP proof-copy scanning remains a publisher step: digital sampling is
evidence of export quality, not an assertion that a physical print was tested.
