# Issue #23 Production cache probe

Read-only probes run on 2026-10-15 at approximately 17:20 UTC against one already-public product gallery image. No R2 objects, Cloudflare settings, Vercel caches, or database rows were changed. The source image was still available throughout the probe; no unpublish or delete operation was performed.

## Source metadata and public delivery

The public object is:

```text
https://media.lamilialomi.com/products/c167b49f-bbb5-43be-9f85-4a7f3a6c4aab/gallery/d955e543-ba16-4d9c-83cc-fc05dd2d3d28-L1-1.png
```

A read-only S3 `HeadObject` using the configured application R2 credentials returned `Cache-Control: public, max-age=60, s-maxage=60, must-revalidate`, `Content-Type: image/png`, and `Content-Length: 1285705`. Secret values were not displayed or recorded. This matches `promoteR2PrivateObject` in the application.

A public custom-domain `HEAD` returned HTTP 200 with `Cache-Control: public, must-revalidate, max-age=14400, s-maxage=60`, `CF-Cache-Status: REVALIDATED`, and no `Age` header. The public response therefore tells browsers to treat the object as fresh for four hours. The response does not reveal the actual Cloudflare edge-cache TTL or its configured cache rule.

Cloudflare documents that its default Browser Cache TTL is four hours and can override a shorter origin browser TTL. The account configuration for this media domain could not be read in this audit, so the cause is consistent with the documented default but is not confirmed from the account. The response header alone also cannot establish the shared edge freshness bound. See [Cloudflare Browser Cache TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/).

## Next.js/Vercel optimized response

The corresponding optimized request was:

```text
https://www.lamilialomi.com/_next/image?url=https%3A%2F%2Fmedia.lamilialomi.com%2Fproducts%2Fc167b49f-bbb5-43be-9f85-4a7f3a6c4aab%2Fgallery%2Fd955e543-ba16-4d9c-83cc-fc05dd2d3d28-L1-1.png&w=3840&q=75
```

A `GET` returned HTTP 200, `Content-Type: image/png`, `Content-Length: 411150`, `Cache-Control: public, must-revalidate, max-age=3600`, `X-Vercel-Cache: STALE`, and `Age: 106776`. A subsequent `HEAD` returned HTTP 200 with the same cache directives and `X-Vercel-Cache: STALE`, now with `Age: 107272`. The response `Date` was `Wed, 14 Oct 2026 11:35:34 GMT`, about 29 hours before these probes. The underlying public source still returned HTTP 200.

This confirms that an optimizer response marked stale was served after its advertised one-hour freshness period while its source remained available. It does not establish what Vercel serves after the source is deleted. Vercel documents that remote-image TTL uses the larger of the upstream `max-age` and `minimumCacheTTL`, and that a cached source image can remain available after its origin changes until expiration or invalidation. `minimumCacheTTL` is a floor, not a maximum; the repository currently sets it to 60 seconds. See [Vercel Image Optimization](https://vercel.com/docs/image-optimization) and [Next.js `minimumCacheTTL`](https://nextjs.org/docs/app/api-reference/components/image#minimumcachettl).

## Replacement and revocation implications

Product and category upload paths include a new UUID for each uploaded asset/image. Replacements therefore use a new source URL and do not overwrite the bytes behind the URL already cached for the previous image. Existing code also fences a public R2 asset before unpublish, archive, removal, or product deletion, copies/retains the private object, and deletes the public source before completing the metadata transition.

Once a public image has been served, deleting its origin cannot recall copies already stored by a browser or CDN. The direct response advertises up to four hours of browser freshness; the optimizer advertises one hour but the probe observed a Vercel `STALE` response more than 29 hours after its response `Date`. The actual Cloudflare edge freshness and post-delete optimizer behavior were not verified. Thus the current application code protects unpublished and premium media from new authorized source delivery, but it does not prove immediate revocation of a previously public URL from all caches.

If an owner requires a bounded direct-browser cache window for future responses, configure the media host's Cloudflare Browser Cache TTL to respect existing origin headers, then verify the response. This does not purge copies already held by browsers and does not control Vercel's separate image optimizer cache. For a deleted source image, the Vercel project owner can remove transformed copies with `vercel cache dangerously-delete --srcimg <absolute-source-image-url>` from the linked project. This is an operator action, may cause a foreground origin request on the next image request, and was not run. See [Vercel cache CLI](https://vercel.com/docs/cli/cache) and [Vercel source-image invalidation changelog](https://vercel.com/changelog/you-can-now-invalidate-the-cdn-cache-by-providing-a-source-image).

No Production cache setting or object was changed. The available Cloudflare read access did not expose the target bucket/custom-domain configuration, so Cloudflare cache rules and effective edge freshness remain an external verification item.
