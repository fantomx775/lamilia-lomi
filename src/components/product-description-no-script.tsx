"use client";

import { useParams } from "next/navigation";

// loading.tsx has no params prop, but the router provides the current slug
// during SSR too. Keep this outside the streamed product-page boundary.
export function ProductDescriptionNoScript() {
  const params = useParams<{ slug: string }>();
  if (!params?.slug) return null;

  return (
    <noscript>
      <p className="mx-auto max-w-7xl px-4 py-4">
        <a className="underline" href={`/api/product-description/${encodeURIComponent(params.slug)}`}>
          Read the full product description without JavaScript
        </a>
      </p>
    </noscript>
  );
}
