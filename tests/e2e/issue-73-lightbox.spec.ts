import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844, isMobile: true },
  { name: "tablet-portrait", width: 768, height: 1024, isMobile: false },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
];

test("product lightbox fits common viewports, keeps controls outside the artwork, and closes accessibly", async ({ browser }) => {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "ll_cookie_consent",
        JSON.stringify({ essential: true, analytics: false }),
      );
    });
    await page.goto("/en/products/moon-garden-coloring-book", { waitUntil: "domcontentloaded" });

    const opener = page.getByRole("button", { name: "Open image 1" });
    await expect(opener).toBeVisible();
    await opener.click();

    const dialog = page.getByRole("dialog", { name: "Image preview" });
    const frame = dialog.getByTestId("product-gallery-preview-frame");
    const previous = dialog.getByRole("button", { name: "Previous image" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("img")).toBeVisible();

    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
      const frame = dialog.querySelector<HTMLElement>("[data-gallery-image-frame]")!;
      const previous = dialog.querySelector<HTMLElement>("[data-gallery-previous]")!;
      const next = dialog.querySelector<HTMLElement>("[data-gallery-next]")!;
      const box = (element: HTMLElement) => {
        const { left, right, top, bottom } = element.getBoundingClientRect();
        return { left, right, top, bottom };
      };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        frame: box(frame),
        previous: box(previous),
        next: box(next),
        objectFit: getComputedStyle(frame.querySelector("img")!).objectFit,
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.frame.left).toBeGreaterThanOrEqual(0);
    expect(geometry.frame.right).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.frame.top).toBeGreaterThanOrEqual(0);
    expect(geometry.frame.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    expect(geometry.objectFit).toBe("contain");

    if (viewport.width < 768) {
      expect(geometry.previous.top).toBeGreaterThanOrEqual(geometry.frame.bottom);
      expect(geometry.next.top).toBeGreaterThanOrEqual(geometry.frame.bottom);
    } else {
      expect(geometry.previous.right).toBeLessThanOrEqual(geometry.frame.left);
      expect(geometry.next.left).toBeGreaterThanOrEqual(geometry.frame.right);
    }

    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByText(/^2 of \d+$/)).toBeVisible();
    await previous.click();
    await expect(dialog.getByText(/^1 of \d+$/)).toBeVisible();

    const frameHandle = await frame.elementHandle();
    await frameHandle?.dispatchEvent("pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 300,
    });
    await frameHandle?.dispatchEvent("pointerup", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
    });
    await expect(dialog.getByText(/^2 of \d+$/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    await context.close();
  }
});
