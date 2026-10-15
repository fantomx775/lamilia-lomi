/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProductDescriptionNoScript } from "./product-description-no-script";
vi.mock("next/navigation", () => ({useParams:()=>({slug:"a-book"})}));
it("server-renders a no-script reading link outside the page stream", () => {
  const html=renderToStaticMarkup(<ProductDescriptionNoScript />);
  expect(html).toContain('<noscript>');
  expect(html).toContain('href="/api/product-description/a-book"');
});
