import { getLocalizedProductDetailViewForRequest } from "@/lib/products-request";
import { getRichTextTextContent } from "@/lib/rich-text";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getLocalizedProductDetailViewForRequest(slug, "en");
  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
  if (!product) return new Response("Product not found.", { status: 404, headers });

  // Only the same published, public view used by the PDP. Plain text is a
  // complete no-script reading fallback, never HTML or a truncated payload.
  return new Response(
    [product.title, product.shortDescription, getRichTextTextContent(product.longDescription)].join("\n\n"),
    { headers },
  );
}
