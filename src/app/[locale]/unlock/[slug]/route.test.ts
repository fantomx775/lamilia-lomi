import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("private QR entry document", () => {
  it("serves a standalone scrub-and-POST document without analytics or a query code", async () => {
    const response = await GET(new Request("https://books.example/en/unlock/11111111-1111-4111-8111-111111111111"), { params: Promise.resolve({ locale: "en", slug: "11111111-1111-4111-8111-111111111111" }) });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(html).toContain('method="post"');
    expect(html.indexOf("history.replaceState")).toBeLessThan(html.indexOf("form.requestSubmit"));
    expect(html).not.toMatch(/googletagmanager|google-analytics|next\/script/);
  });

  it("retains old query-string QR links and their product identifier", async () => {
    const response = await GET(new Request("https://books.example/en/unlock/old-title?productId=stable-id&code=PRINTED-CODE"), { params: Promise.resolve({ locale: "en", slug: "old-title" }) });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://books.example/api/unlock/en/old-title?productId=stable-id&code=PRINTED-CODE");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects unsafe path values rather than embedding them in HTML", async () => {
    const response = await GET(new Request("https://books.example/en/unlock/book"), { params: Promise.resolve({ locale: "en", slug: '\"><script>bad</script>' }) });
    expect(response.status).toBe(404);
  });
});
