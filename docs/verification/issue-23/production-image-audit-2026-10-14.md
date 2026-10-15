# Issue #23 read-only Production image audit

This 2026-10-14 audit recorded headers from public HTTP responses. Its `Source Cache-Control` column describes the public custom-domain response, not the stored R2 object metadata. A follow-up read-only R2 `HeadObject` on 2026-10-15 confirmed that the sampled gallery object's stored metadata is `public, max-age=60, s-maxage=60, must-revalidate`, matching the application. The public response still advertises a four-hour browser TTL; see the [2026-10-15 cache probe](production-cache-probe-2026-10-15.md) for the source-versus-CDN distinction and current optimizer evidence.

Audited 2026-10-14 at approximately 11:34 UTC. Requests used the public storefront and public R2 media URLs only. No credentials, private assets, upload endpoints, category assignments, or Production writes were used.

## Public product image sample

The public `/en/products/https-www-amazon-com-dp-b0hlthrwdh` product page rendered one cover and four gallery images from `media.lamilialomi.com`.

| Asset | Source dimensions | Source bytes | Public response `Cache-Control` | Observation |
| --- | ---: | ---: | --- | --- |
| Cover `020c4704…-ok-adka2-gigapixel-standard-v2-2-5x.png` | 2758×3565 | 15,997,125 | `public, must-revalidate, max-age=14400, s-maxage=60` | Public `HEAD` returned 200 `image/png`; downloaded and decoded with Pillow. |
| Gallery `d955e543…-L1-1.png` | 1533×2000 | 1,285,705 | `public, must-revalidate, max-age=14400, s-maxage=60` | Public `HEAD` returned 200 `image/png`; downloaded and decoded with Pillow. |

The gallery detail preview uses `sizes="(max-width: 768px) 94vw, 76rem"`. At the 76rem desktop maximum (1216 CSS pixels), a 2× display target is 2432 pixels wide, exceeding this gallery source's 1533 pixels. The source is still adequate for the cover-sized catalog card and normal 1× preview, but this sample does not establish sharpness at every device pixel ratio.

The Next image optimizer request for the gallery source at `w=3840&q=75` returned HTTP 200, `image/png`, 411,150 bytes, and a 1533×2000 image. The optimizer preserved source dimensions instead of upscaling the 1533-pixel source to 3840 pixels. Its response advertised `Cache-Control: public, must-revalidate, max-age=3600`.

## Cache result

The sampled public image responses advertised a four-hour browser `max-age` and a one-minute shared-cache `s-maxage`. The sampled optimized image advertised a one-hour `max-age`. A follow-up origin metadata check confirmed that the stored R2 object metadata has the application's one-minute directives; the public response differs. The live browser response and optimized response headers do not establish a one-minute cache bound. The dated follow-up also found the optimized response marked stale well after that one-hour freshness period.

Before claiming a one-minute stale-delivery bound, inspect and correct the deployed R2 object metadata/Cloudflare cache configuration and the Next image response policy, then repeat these read-only checks. This audit does not modify cache configuration, objects, or the database.

## Category-image result

The Issue #23 owner comment dated 2026-10-12 records a Production read of three categories with zero image assignments after PR #46. No representative category image was available to inspect or render in this audit. Category upload, replacement, rendering, and removal remain covered by the synthetic/local Issue #24 flow; a live category assignment and storefront render remain outstanding.

## Reproduction commands

```powershell
Invoke-WebRequest -Uri 'https://www.lamilialomi.com/en/products/https-www-amazon-com-dp-b0hlthrwdh'
Invoke-WebRequest -Method Head -Uri 'https://media.lamilialomi.com/products/c167b49f-bbb5-43be-9f85-4a7f3a6c4aab/cover/020c4704-b6aa-46e3-a727-e293b9bd2645-ok-adka2-gigapixel-standard-v2-2-5x.png'
Invoke-WebRequest -Method Head -Uri 'https://media.lamilialomi.com/products/c167b49f-bbb5-43be-9f85-4a7f3a6c4aab/gallery/d955e543-ba16-4d9c-83cc-fc05dd2d3d28-L1-1.png'
```

The optimized request is the same gallery URL encoded as the `url` query parameter of `https://www.lamilialomi.com/_next/image`, with `w=3840&q=75`.
