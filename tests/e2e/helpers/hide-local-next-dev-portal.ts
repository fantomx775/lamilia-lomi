import type { Locator, Page } from "@playwright/test";

/** Hide Next's local-only dev portal only when it intercepts the target click. */
export async function hideLocalNextDevPortalIfBlocking(page: Page, target: Locator) {
  const hostname = new URL(page.url()).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return;

  const portalInterceptsTarget = await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const top = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    let candidate: Element | null = top;
    while (candidate) {
      if (candidate.localName === "nextjs-portal") return true;
      const root = candidate.getRootNode();
      candidate = root instanceof ShadowRoot ? root.host : candidate.parentElement;
    }
    return false;
  });

  if (portalInterceptsTarget) {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  }
}
