import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { getSeedContentSnapshot } from "../../src/lib/local-content";
import type { Product } from "../../src/lib/types";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

const contentPath = path.join(process.cwd(), "data", "lamilialomi-content.local.json");
const fixtureCoverFiles = [
  "issue50-quiet.svg",
  "issue50-garden.svg",
  "issue50-little-star.svg",
  "issue50-forest-friends.svg",
] as const;
const fixtureCoverDirectory = path.join(process.cwd(), "tests", "e2e", "fixtures", "issue-50");
const publicCoverDirectory = path.join(process.cwd(), "public", "assets", "covers");
const productSelections = [
  { label: "Favorite Coloring Books, pozycja 1", query: "Moon Garden", title: "Moon Garden Coloring Book", id: "11111111-1111-4111-8111-111111111111" },
  { label: "Favorite Coloring Books, pozycja 2", query: "Mindful Mandalas", title: "Mindful Mandalas for Adults", id: "22222222-2222-4222-8222-222222222222" },
  { label: "Favorite Coloring Books, pozycja 3", query: "Garden Whispers", title: "Garden Whispers Coloring Book", id: "55555555-5555-4555-8555-555555555555" },
  { label: "Favorite Picture Books, pozycja 1", query: "Bedtime Forest", title: "Bedtime Forest Picture Book", id: "33333333-3333-4333-8333-333333333333" },
  { label: "Favorite Picture Books, pozycja 2", query: "Little Star", title: "The Little Star Picture Book", id: "66666666-6666-4666-8666-666666666666" },
  { label: "Favorite Picture Books, pozycja 3", query: "Forest Friends", title: "Forest Friends Picture Book", id: "77777777-7777-4777-8777-777777777777" },
] as const;

test("About settings save six unique books and render responsively from current product data", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Runs the local content-store flow once in Chromium at explicit desktop and mobile widths.");
  test.setTimeout(180_000);

  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Issue #50 browser flow requires the loopback local demo backend.",
  );

  const releaseContentStoreLock = await acquireLocalContentStoreLock();
  const originalContent = fs.existsSync(contentPath) ? fs.readFileSync(contentPath) : undefined;
  const originalFixtureCovers = new Map(fixtureCoverFiles.map((fileName) => {
    const publicPath = path.join(publicCoverDirectory, fileName);
    return [publicPath, fs.existsSync(publicPath) ? fs.readFileSync(publicPath) : undefined] as const;
  }));
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const serverErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "failed";
    const expectedNextAbort = failure === "net::ERR_ABORTED" && (
      (request.method() === "POST" && Boolean(request.headers()["next-action"])) ||
      (request.method() === "GET" && new URL(request.url()).searchParams.has("_rsc"))
    );
    if (!expectedNextAbort) failedRequests.push(`${request.method()} ${request.url()}: ${failure}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  try {
    const content = getSeedContentSnapshot();
    const coloringTemplate = content.products.find((product) => product.id === productSelections[0].id);
    const pictureTemplate = content.products.find((product) => product.id === productSelections[3].id);
    if (!coloringTemplate || !pictureTemplate) throw new Error("About page seed products were not available.");

    content.products.push(
      createAboutFixtureProduct(coloringTemplate, {
        id: "55555555-5555-4555-8555-555555555555",
        slug: "issue-50-garden-whispers",
        title: "Garden Whispers Coloring Book",
        description: "A peaceful garden coloring collection.",
        coverFileName: "issue50-garden.svg",
      }),
      createAboutFixtureProduct(pictureTemplate, {
        id: "66666666-6666-4666-8666-666666666666",
        slug: "issue-50-little-star",
        title: "The Little Star Picture Book",
        description: "A tender story about a curious star.",
        coverFileName: "issue50-little-star.svg",
      }),
      createAboutFixtureProduct(pictureTemplate, {
        id: "77777777-7777-4777-8777-777777777777",
        slug: "issue-50-forest-friends",
        title: "Forest Friends Picture Book",
        description: "A gentle woodland adventure for little readers.",
        coverFileName: "issue50-forest-friends.svg",
      }),
      createAboutFixtureProduct(coloringTemplate, {
        id: "88888888-8888-4888-8888-888888888888",
        slug: "issue-50-quiet-patterns",
        title: "Quiet Patterns Coloring Book",
        description: "A calm collection of playful patterns to color.",
        coverFileName: "issue50-quiet.svg",
      }),
    );
    content.aboutPageSettings = {
      intro: "",
      favoriteColoringBookIds: ["", "", ""],
      favoritePictureBookIds: ["", "", ""],
    };
    fs.mkdirSync(path.dirname(contentPath), { recursive: true });
    fs.mkdirSync(publicCoverDirectory, { recursive: true });
    for (const fileName of fixtureCoverFiles) {
      fs.copyFileSync(path.join(fixtureCoverDirectory, fileName), path.join(publicCoverDirectory, fileName));
    }
    fs.writeFileSync(contentPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(() => {
      window.localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false }));
    });
    await page.goto("/en/login?redirectTo=/admin");
    await page.getByLabel("Email").fill("admin@lamilialomi.test");
    await page.getByLabel("Password").fill("demo-password");
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/admin"),
      page.getByRole("button", { name: "Continue" }).click(),
    ]);

    await page.getByRole("link", { name: "Strony", exact: true }).click();
    await page.getByRole("link", { name: "About Lamilia Lomi", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "About Lamilia Lomi" }))
      .toBeVisible({ timeout: 30_000 });
    await page.getByRole("textbox", { name: "Wprowadzenie" }).fill("Books that bring calm, color, and wonder to every day.");

    for (const product of productSelections) {
      const slot = page.getByRole("combobox", { name: product.label });
      await slot.click();
      await slot.fill(product.query);
      await page.getByRole("option", { name: new RegExp(product.title) }).click();
    }

    const secondColoringSlot = page.getByRole("combobox", { name: productSelections[1].label });
    await secondColoringSlot.click();
    await secondColoringSlot.fill("Moon Garden");
    await expect(page.getByRole("option", { name: /Moon Garden Coloring Book/ })).toHaveCount(0);

    const firstColoringSlot = page.getByRole("combobox", { name: productSelections[0].label });
    await firstColoringSlot.click();
    await firstColoringSlot.fill("Quiet Patterns");
    await page.getByRole("option", { name: /Quiet Patterns Coloring Book/ }).click();
    await secondColoringSlot.click();
    await secondColoringSlot.fill("Quiet Patterns");
    await expect(page.getByRole("option", { name: /Quiet Patterns Coloring Book/ })).toHaveCount(0);
    await secondColoringSlot.fill("Moon Garden");
    await expect(page.getByRole("option", { name: /Moon Garden Coloring Book/ })).toBeVisible();
    await secondColoringSlot.fill("Mindful Mandalas");

    await page.getByRole("button", { name: "Przesuń produkt Coloring Books, pozycja 3, wyżej" }).click();
    const actionRequestPromise = page.waitForRequest((request) =>
      request.method() === "POST" && Boolean(request.headers()["next-action"]),
    );
    await page.getByRole("button", { name: "Zapisz" }).first().click();
    await page.waitForURL(/\/admin\/pages\/about\?saved=1$/);
    const actionRequest = await actionRequestPromise;

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Wprowadzenie" })).toContainText(
      "Books that bring calm, color, and wonder to every day.",
    );
    await expect(page.getByRole("combobox", { name: productSelections[0].label })).toHaveValue("Quiet Patterns Coloring Book");
    await expect(page.getByRole("combobox", { name: productSelections[1].label })).toHaveValue("Garden Whispers Coloring Book");
    await expect(page.getByRole("combobox", { name: productSelections[2].label })).toHaveValue("Mindful Mandalas for Adults");
    await expect(page.getByRole("combobox", { name: productSelections[3].label })).toHaveValue("Bedtime Forest Picture Book");
    await expect(page.getByRole("combobox", { name: productSelections[4].label })).toHaveValue("The Little Star Picture Book");
    await expect(page.getByRole("combobox", { name: productSelections[5].label })).toHaveValue("Forest Friends Picture Book");

    await page.locator("header").getByRole("link", { name: "About", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/about$/);
    await expect(page.getByRole("heading", { level: 1, name: "About Lamilia Lomi" })).toBeVisible();
    await expect(page.getByText("Loved by Our Readers")).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(6);
    const coloringSection = page.getByRole("region", { name: "Favorite Coloring Books" });
    const coloringTitles = await coloringSection.getByRole("heading", { level: 3 }).allTextContents();
    expect(coloringTitles).toEqual([
      "Quiet Patterns Coloring Book",
      "Garden Whispers Coloring Book",
      "Mindful Mandalas for Adults",
    ]);
    const gardenBookHeading = page.getByRole("heading", { level: 3, name: "Garden Whispers Coloring Book" });
    const gardenBookCard = page.getByRole("article").filter({ has: gardenBookHeading }).last();
    await expect(gardenBookCard).toContainText("A peaceful garden coloring collection.");
    await expect(gardenBookCard.getByRole("link", { name: "View on Amazon" }))
      .toHaveAttribute("href", /^https:\/\/www\.amazon\./);
    const amazonLinks = page.getByRole("link", { name: "View on Amazon" });
    await expect(amazonLinks).toHaveCount(6);
    for (let index = 0; index < await amazonLinks.count(); index += 1) {
      await expect(amazonLinks.nth(index)).toHaveAttribute("href", /^https:\/\/www\.amazon\./);
    }
    for (const product of productSelections.slice(3)) {
      await expect(page.getByRole("heading", { level: 3, name: product.title })).toBeVisible();
    }
    await expect(page.locator("footer").getByRole("link", { name: "About", exact: true })).toHaveAttribute("href", "/en/about");

    const coverImages = page.locator("main img");
    for (let index = 0; index < await coverImages.count(); index += 1) {
      const cover = coverImages.nth(index);
      await cover.scrollIntoViewIfNeeded();
      await expect.poll(() => cover.evaluate((image) => {
        const element = image as HTMLImageElement;
        return element.complete && element.naturalWidth > 0;
      })).toBe(true);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: testInfo.outputPath("about-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("heading", { level: 1, name: "About Lamilia Lomi" })).toBeVisible();
    await expect(page.getByRole("link", { name: "About", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(6);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("about-mobile.png"), fullPage: true });

    const modifiedContent = JSON.parse(fs.readFileSync(contentPath, "utf8")) as {
      products: Array<{ id: string; status: string }>;
      aboutPageSettings: {
        favoriteColoringBookIds: string[];
        favoritePictureBookIds: string[];
      };
    };
    const staleProductId = modifiedContent.aboutPageSettings.favoriteColoringBookIds[0];
    const unpublishedProductId = modifiedContent.aboutPageSettings.favoritePictureBookIds[0];
    modifiedContent.products = modifiedContent.products.filter((product) => product.id !== staleProductId);
    const unpublishedProduct = modifiedContent.products.find((product) => product.id === unpublishedProductId);
    if (!unpublishedProduct) throw new Error("The selected picture book fixture was not present in the local store.");
    unpublishedProduct.status = "draft";
    fs.writeFileSync(contentPath, `${JSON.stringify(modifiedContent, null, 2)}\n`, "utf8");

    await page.reload();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(4);
    await page.goto("/admin/pages/about");
    await expect(page.getByText(/nie jest już dostępny/)).toBeVisible();
    await expect(page.getByText(/nie jest opublikowany/)).toBeVisible();

    if (actionRequest) {
      const guestContext = await browser.newContext();
      try {
        const headers = { ...actionRequest.headers() };
        delete headers.cookie;
        delete headers.host;
        delete headers.connection;
        delete headers["content-length"];
        delete headers["accept-encoding"];
        const response = await guestContext.request.post(actionRequest.url(), {
          data: actionRequest.postDataBuffer() ?? undefined,
          headers,
          maxRedirects: 0,
        });
        const redirectTarget = response.headers()["x-action-redirect"]
          ?? response.headers().location
          ?? await response.text();
        expect(response.status()).toBeLessThan(400);
        expect(redirectTarget).toContain("/en/login");
      } finally {
        await guestContext.close();
      }
    }

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(serverErrors).toEqual([]);
  } finally {
    try {
      if (originalContent) fs.writeFileSync(contentPath, originalContent);
      else if (fs.existsSync(contentPath)) fs.rmSync(contentPath);

      for (const [publicPath, originalContents] of originalFixtureCovers) {
        if (originalContents) fs.writeFileSync(publicPath, originalContents);
        else if (fs.existsSync(publicPath)) fs.rmSync(publicPath);
      }
    } finally {
      releaseContentStoreLock();
    }
  }
});

function createAboutFixtureProduct(
  template: Product,
  fixture: {
    id: string;
    slug: string;
    title: string;
    description: string;
    coverFileName: string;
  },
): Product {
  const translation = template.translations.find((entry) => entry.locale === "en") ?? template.translations[0];
  const cover = template.assets.find((asset) => asset.kind === "cover");
  if (!translation || !cover) throw new Error(`About page fixture template is incomplete: ${template.id}`);

  const coverAssetId = `${fixture.id}-cover`;
  const description = fixture.description;
  return {
    ...structuredClone(template),
    id: fixture.id,
    slug: fixture.slug,
    status: "published",
    sortOrder: 20,
    coverAssetId,
    videoAssetId: undefined,
    translations: [{
      ...translation,
      locale: "en",
      title: fixture.title,
      shortDescription: description,
      longDescription: description,
      seoTitle: fixture.title,
      seoDescription: description,
    }],
    assets: [{
      ...cover,
      id: coverAssetId,
      productId: fixture.id,
      path: `/assets/covers/${fixture.coverFileName}`,
      storagePath: undefined,
      storageProvider: undefined,
      filename: fixture.coverFileName,
      contentType: "image/svg+xml",
      title: `${fixture.title} cover`,
      isPublic: true,
      isActive: true,
    }],
    amazonLinks: template.amazonLinks.filter((link) => link.isPrimary).map((link, index) => ({
      ...link,
      id: `${fixture.id}-amazon-${index + 1}`,
      productId: fixture.id,
    })),
    premiumCodes: [],
  };
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
}
