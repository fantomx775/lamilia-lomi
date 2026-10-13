import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const evidenceDirectory = path.resolve(process.cwd(), "docs", "verification", "issue-49");
const runEnabled = process.env.RUN_ISSUE_49_SUPABASE_E2E === "1";
const expect = baseExpect.configure({ timeout: 30_000 });

test.use({ trace: "off", screenshot: "off", video: "off" });

test("collections persist through the isolated local Supabase database on desktop and Pixel 7", async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(30_000);
  test.skip(!runEnabled, "Requires the explicitly configured isolated local Supabase stack.");

  const appUrl = requireLoopbackUrl(process.env.PLAYWRIGHT_BASE_URL, 3030, "application");
  const supabaseUrl = requireLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 54321, "isolated Supabase");
  if (process.env.LAMILIA_BACKEND !== "supabase") {
    throw new Error("The application must be explicitly configured for Supabase mode.");
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!serviceRoleKey || !publishableKey) {
    throw new Error("The isolated local Supabase keys are unavailable to this test process.");
  }

  const admin = createClient(supabaseUrl.href, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const runId = randomUUID().slice(0, 8);
  const collectionName = `Issue 49 ${testInfo.project.name} ${runId} collection`;
  const editedCollectionName = `${collectionName} edited`;
  const collectionSlug = `issue-49-${testInfo.project.name}-${runId}`;
  const editedCollectionSlug = `${collectionSlug}-edited`;
  const productTitle = `Issue 49 ${testInfo.project.name} ${runId} product`;
  const productSlug = `issue-49-${testInfo.project.name}-${runId}-product`;
  const overflowProductTitle = `${productTitle} 50 tags`;
  const overflowProductSlug = `${productSlug}-50-tags`;
  const adminCredentials = credentials("admin", runId);
  const userCredentials = credentials("user", runId);
  const createdUserIds: string[] = [];
  const productIds: string[] = [];
  const tagIds: string[] = [];
  const uploadedImagePaths = new Set<string>();
  const screenshotNames: string[] = [];
  let collectionId = "";
  let savedImagePath = "";
  let cleanupSucceeded = true;
  const collectionPng = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 40, g: 70, b: 90 } },
  }).png().toBuffer();
  const replacementJpeg = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 80, g: 45, b: 65 } },
  }).jpeg().toBuffer();

  try {
    const createdAdmin = await admin.auth.admin.createUser({
      ...adminCredentials,
      email_confirm: true,
      app_metadata: { role: "admin" },
    });
    if (createdAdmin.error || !createdAdmin.data.user) {
      throw new Error("Could not create the isolated local admin account.");
    }
    createdUserIds.push(createdAdmin.data.user.id);
    const createdUser = await admin.auth.admin.createUser({ ...userCredentials, email_confirm: true });
    if (createdUser.error || !createdUser.data.user) {
      throw new Error("Could not create the isolated local non-admin account.");
    }
    createdUserIds.push(createdUser.data.user.id);

    // GoTrue creates the profile before applying admin app metadata on this local stack.
    // Promote only this disposable local fixture through the service role.
    const promotedProfile = await admin.from("profiles").update({ role: "admin" }).eq("id", createdAdmin.data.user.id).select("id").single();
    expect(promotedProfile.error).toBeNull();
    const adminProfile = await admin.from("profiles").select("role").eq("id", createdAdmin.data.user.id).single();
    if (adminProfile.error || !adminProfile.data) throw new Error("Could not verify the isolated local admin profile.");
    expect(adminProfile.data.role).toBe("admin");

    await page.addInitScript(() => {
      window.localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false }));
    });
    await signInAs(page, adminCredentials);

    await page.goto("/admin/collections");
    await page.getByRole("button", { name: "Dodaj kolekcję" }).click();
    collectionId = await page.locator('input[name="id"]').inputValue();
    await page.getByLabel("Nazwa").fill(collectionName);
    await page.getByLabel("Slug").fill(collectionSlug);
    await page.getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(page.getByRole("button", { name: `Edytuj kolekcję ${collectionName}` }).first()).toBeVisible();

    await page.getByRole("button", { name: `Edytuj kolekcję ${collectionName}` }).first().click();
    await page.getByLabel("Nazwa").fill(editedCollectionName);
    await page.getByLabel("Slug").fill(editedCollectionSlug);
    const firstUpload = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/collection-image",
    );
    await page.locator('input[type="file"][aria-label="Wybierz obraz kolekcji"]').setInputFiles({
      name: "collection.png",
      mimeType: "image/png",
      buffer: collectionPng,
    });
    const firstUploadResponse = await firstUpload;
    expect(firstUploadResponse.ok()).toBe(true);
    savedImagePath = ((await firstUploadResponse.json()).image as { path: string }).path;
    uploadedImagePaths.add(savedImagePath);
    const firstPreview = page.getByAltText(`Podgląd obrazu kolekcji ${editedCollectionName}`);
    await expect(firstPreview).toBeVisible();
    await expect(firstPreview).toHaveJSProperty("naturalWidth", 1);
    await saveScreenshot(page, `supabase-collection-editor-${testInfo.project.name}.png`, firstPreview);
    screenshotNames.push(`supabase-collection-editor-${testInfo.project.name}.png`);
    await page.getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(page.getByRole("button", { name: `Edytuj kolekcję ${editedCollectionName}` }).first()).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: `Edytuj kolekcję ${editedCollectionName}` }).first().click();
    await expect(page.getByLabel("Nazwa")).toHaveValue(editedCollectionName);
    await expect(page.getByLabel("Slug")).toHaveValue(editedCollectionSlug);
    const persistedImage = page.getByAltText(`Podgląd obrazu kolekcji ${editedCollectionName}`);
    await expect(persistedImage).toBeVisible();
    await expect(persistedImage).toHaveJSProperty("naturalWidth", 1);
    const savedCollection = await admin.from("collections").select("image_path,image_filename,image_content_type,image_size_bytes").eq("id", collectionId).single();
    if (savedCollection.error || !savedCollection.data) throw new Error("Could not verify the saved local collection image metadata.");
    expect(savedCollection.data.image_path).toBe(savedImagePath);
    expect(savedCollection.data.image_content_type).toBe("image/png");
    expect(savedCollection.data.image_size_bytes).toBeGreaterThan(0);
    const imageObject = await admin.storage.from("collection-media").download(savedImagePath);
    expect(imageObject.error).toBeNull();
    expect(imageObject.data).not.toBeNull();
    await saveScreenshot(page, `supabase-collection-image-reloaded-${testInfo.project.name}.png`, persistedImage);
    screenshotNames.push(`supabase-collection-image-reloaded-${testInfo.project.name}.png`);
    await page.getByRole("button", { name: "Anuluj" }).click();

    await page.goto("/admin/products/new");
    await page.getByLabel("Tytuł").fill(productTitle);
    await page.getByLabel("Krótki opis").fill("Temporary Supabase-backed product for Issue 49 verification.");
    await page.getByLabel("Adres produktu").fill(productSlug);
    await page.getByLabel("Pozycja w katalogu").fill("1");
    await page.getByLabel("Kolekcja").selectOption({ label: editedCollectionName });
    for (const category of ["Coloring books", "Picture books", "Mindfulness"]) {
      await page.getByLabel(category).check();
    }
    for (const tag of ["Printable bonus", "Amazon KDP", "Calm evening"]) {
      await page.getByLabel(tag).check();
    }
    const productId = await page.locator('#product-editor-form input[name="id"]').inputValue();
    productIds.push(productId);
    await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expectProductSaveConfirmation(page);
    await page.goto(`/admin/products/${productId}`);
    await expect(page.getByLabel("Kolekcja")).toHaveValue(collectionId);
    await expect(page.getByLabel("Mindfulness")).toBeChecked();
    await expect(page.getByLabel("Calm evening")).toBeChecked();
    await page.getByLabel("Kolekcja").selectOption("");
    await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expectProductSaveConfirmation(page);
    await page.reload();
    await expect(page.getByLabel("Kolekcja")).toHaveValue("");
    await page.getByLabel("Kolekcja").selectOption({ label: editedCollectionName });
    await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expectProductSaveConfirmation(page);
    await page.reload();
    await expect(page.getByLabel("Kolekcja")).toHaveValue(collectionId);

    const overflowTags = await createOverflowTags(admin, testInfo.project.name, runId, (ids) => tagIds.push(...ids));
    await page.goto("/admin/products/new");
    await page.getByLabel("Tytuł").fill(overflowProductTitle);
    await page.getByLabel("Krótki opis").fill("Temporary product used to verify 50 Supabase-backed tags.");
    await page.getByLabel("Adres produktu").fill(overflowProductSlug);
    await page.getByLabel("Pozycja w katalogu").fill("2");
    for (const tag of overflowTags) {
      await page.locator(`#product-editor-form input[name="tagIds"][value="${tag.id}"]`).check();
    }
    const overflowProductId = await page.locator('#product-editor-form input[name="id"]').inputValue();
    productIds.push(overflowProductId);
    await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expectProductSaveConfirmation(page);
    await page.goto("/admin/products");

    const productLink = page.locator(`a[href="/admin/products/${productId}"]:visible`).first();
    await expect(productLink).toBeVisible();
    const productContainer = productListContainer(page, productLink, testInfo.project.name);
    await expect(productContainer.getByText(editedCollectionName, { exact: true })).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await expect(page.getByRole("columnheader", { name: "Kolekcja" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Kategorie" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Tagi" })).toBeVisible();
    } else {
      await expect(page.locator("dt").filter({ hasText: "Kolekcja" }).first()).toBeVisible();
    }
    const categoryToggle = productContainer.locator('button[aria-controls*="-category-"]').first();
    const tagToggle = productContainer.locator('button[aria-controls*="-tag-"]').first();
    await expect(categoryToggle).toBeVisible();
    await expect(tagToggle).toBeVisible();
    await categoryToggle.click();
    const categoriesPopover = page.locator(`#${await categoryToggle.getAttribute("aria-controls")}`);
    await expect(categoriesPopover.getByText("Mindfulness", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await tagToggle.click();
    const tagsPopover = page.locator(`#${await tagToggle.getAttribute("aria-controls")}`);
    await expect(tagsPopover.getByText("Calm evening", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await saveScreenshot(page, `supabase-products-taxonomy-${testInfo.project.name}.png`, productLink);
    screenshotNames.push(`supabase-products-taxonomy-${testInfo.project.name}.png`);

    const overflowProductLink = page.locator(`a[href="/admin/products/${overflowProductId}"]:visible`).first();
    await expect(overflowProductLink).toBeVisible();
    const overflowContainer = productListContainer(page, overflowProductLink, testInfo.project.name);
    const overflowButton = overflowContainer.getByRole("button", { name: /Pokaż 48 kolejnych tagów/ });
    await expect(overflowButton).toBeVisible();
    const overflowPopoverId = await overflowButton.getAttribute("aria-controls");
    await overflowButton.click();
    const overflowPopover = page.locator(`#${overflowPopoverId}`);
    await expect(overflowPopover.getByText(overflowTags[49]!.name, { exact: true })).toBeVisible();
    await saveScreenshot(page, `supabase-products-tag-overflow-${testInfo.project.name}.png`, overflowProductLink);
    screenshotNames.push(`supabase-products-tag-overflow-${testInfo.project.name}.png`);

    const normalContext = await browser.newContext({ baseURL: appUrl.origin });
    try {
      const normalPage = await normalContext.newPage();
      await normalPage.addInitScript(() => {
        window.localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false }));
      });
      await signInAs(normalPage, userCredentials);
      await normalPage.goto("/admin/collections");
      await expect(normalPage.getByRole("heading", { name: "Brak dostępu" })).toBeVisible();

      const normalClient = createClient(supabaseUrl.href, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
      const normalSignIn = await normalClient.auth.signInWithPassword(userCredentials);
      expect(normalSignIn.error).toBeNull();
      const hiddenCollections = await normalClient.from("collections").select("id").eq("id", collectionId);
      expect(hiddenCollections.error).toBeNull();
      expect(hiddenCollections.data).toEqual([]);
      const deniedInsert = await normalClient.from("collections").insert({
        id: randomUUID(), name: "Forbidden collection", slug: `forbidden-${runId}`,
      });
      expect(deniedInsert.error).not.toBeNull();
      const deniedUpdate = await normalClient.from("collections").update({ name: "Forbidden rename" }).eq("id", collectionId).select("id");
      expect(deniedUpdate.error).toBeNull();
      expect(deniedUpdate.data).toEqual([]);
      const deniedDelete = await normalClient.from("collections").delete().eq("id", collectionId).select("id");
      expect(deniedDelete.error).toBeNull();
      expect(deniedDelete.data).toEqual([]);
      const stillThere = await admin.from("collections").select("name").eq("id", collectionId).single();
      expect(stillThere.data?.name).toBe(editedCollectionName);

      const deniedPath = `collections/${collectionId}/image/${randomUUID()}-denied.png`;
      const imageQuery = new URLSearchParams({ collectionId, path: deniedPath, provider: "supabase", contentType: "image/png" });
      expect((await normalContext.request.get(`/api/admin/collection-image?${imageQuery}`)).status()).toBe(403);
      expect((await normalContext.request.post("/api/admin/collection-image", {
        multipart: { collectionId, file: { name: "denied.png", mimeType: "image/png", buffer: collectionPng } },
      })).status()).toBe(403);
      expect((await normalContext.request.delete("/api/admin/collection-image", {
        data: { collectionId, path: deniedPath, provider: "supabase" },
      })).status()).toBe(403);
      const deniedStorageWrite = await normalClient.storage.from("collection-media").upload(deniedPath, collectionPng, { contentType: "image/png" });
      expect(deniedStorageWrite.error).not.toBeNull();
    } finally {
      await normalContext.close();
    }

    await page.goto("/admin/collections");
    if (testInfo.project.name === "chromium") {
      await expect(page.getByRole("row").filter({ hasText: editedCollectionName }).locator("td").last()).toHaveText("1");
    } else {
      await expect(page.getByText("1 produkt", { exact: true })).toBeVisible();
    }
    await saveScreenshot(page, `supabase-collections-${testInfo.project.name}.png`, page.getByRole("button", { name: `Edytuj kolekcję ${editedCollectionName}` }).first());
    screenshotNames.push(`supabase-collections-${testInfo.project.name}.png`);

    await page.getByRole("button", { name: `Edytuj kolekcję ${editedCollectionName}` }).first().click();
    await page.getByRole("button", { name: "Usuń obraz kolekcji" }).click();
    await expect(page.getByText("Nie dodano obrazu.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edytuj kolekcję" })).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: `Edytuj kolekcję ${editedCollectionName}` }).first().click();
    await expect(page.getByText("Nie dodano obrazu.", { exact: true })).toBeVisible();
    const imageRemoved = await admin.from("collections").select("image_path").eq("id", collectionId).single();
    expect(imageRemoved.data?.image_path).toBeNull();
    const oldImageName = savedImagePath.split("/").at(-1);
    const oldImageDirectory = savedImagePath.slice(0, savedImagePath.lastIndexOf("/"));
    const remainingOldImages = await admin.storage.from("collection-media").list(oldImageDirectory);
    expect(remainingOldImages.error).toBeNull();
    expect(remainingOldImages.data?.some((item) => item.name === oldImageName)).toBe(false);

    const replacementUpload = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/collection-image",
    );
    await page.locator('input[type="file"][aria-label="Wybierz obraz kolekcji"]').setInputFiles({
      name: "replacement.jpg",
      mimeType: "image/jpeg",
      buffer: replacementJpeg,
    });
    const replacementResponse = await replacementUpload;
    expect(replacementResponse.ok()).toBe(true);
    const replacementPath = ((await replacementResponse.json()).image as { path: string }).path;
    uploadedImagePaths.add(replacementPath);
    await page.getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edytuj kolekcję" })).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: `Edytuj kolekcję ${editedCollectionName}` }).first().click();
    const replacementPreview = page.getByAltText(`Podgląd obrazu kolekcji ${editedCollectionName}`);
    await expect(replacementPreview).toBeVisible();
    await expect(replacementPreview).toHaveJSProperty("naturalWidth", 1);
    const replacementSaved = await admin.from("collections").select("image_path,image_content_type").eq("id", collectionId).single();
    expect(replacementSaved.data?.image_path).toBe(replacementPath);
    expect(replacementSaved.data?.image_content_type).toBe("image/jpeg");
    expect((await admin.storage.from("collection-media").download(replacementPath)).error).toBeNull();

    await withAcceptedConfirmation(page, () => page.getByRole("button", { name: "Usuń kolekcję" }).click());
    await expect(page.getByRole("button", { name: `Edytuj kolekcję ${editedCollectionName}` })).toHaveCount(0);
    await page.goto(`/admin/products/${productIds[0]}`);
    await expect(page.getByLabel("Tytuł")).toHaveValue(productTitle);
    await expect(page.getByLabel("Kolekcja")).toHaveValue("");
    await expect(page.getByLabel("Mindfulness")).toBeChecked();
    await expect(page.getByLabel("Calm evening")).toBeChecked();
    const survivingProduct = await admin.from("products").select("id").eq("id", productIds[0]).single();
    expect(survivingProduct.error).toBeNull();
  } finally {
    const cleanupErrors: string[] = [];
    const attemptCleanup = async (label: string, action: () => PromiseLike<unknown>) => {
      try {
        const result = await action();
        if (result && typeof result === "object" && "error" in result && result.error) cleanupErrors.push(label);
      } catch {
        cleanupErrors.push(label);
      }
    };
    if (productIds.length) {
      await attemptCleanup("products", () => admin.from("products").delete().in("id", productIds));
    }
    if (tagIds.length) {
      await attemptCleanup("tags", () => admin.from("tags").delete().in("id", tagIds));
    }
    if (collectionId) {
      let currentImagePath: string | null = null;
      try {
        const currentCollection = await admin.from("collections").select("image_path").eq("id", collectionId).maybeSingle();
        if (currentCollection.error) cleanupErrors.push("collection image lookup");
        currentImagePath = currentCollection.data?.image_path ?? null;
      } catch {
        cleanupErrors.push("collection image lookup");
      }
      if (currentImagePath) {
        uploadedImagePaths.add(currentImagePath);
      }
      if (uploadedImagePaths.size) {
        await attemptCleanup("collection images", () => admin.storage.from("collection-media").remove([...uploadedImagePaths]));
      }
      await attemptCleanup("collection", () => admin.from("collections").delete().eq("id", collectionId));
    } else if (uploadedImagePaths.size) {
      await attemptCleanup("collection images", () => admin.storage.from("collection-media").remove([...uploadedImagePaths]));
    }
    for (const userId of createdUserIds) {
      await attemptCleanup("auth user", () => admin.auth.admin.deleteUser(userId));
    }
    cleanupSucceeded = cleanupErrors.length === 0;
    await testInfo.attach("issue-49-supabase-browser-evidence.json", {
      body: Buffer.from(JSON.stringify({
        backend: "isolated local Supabase",
        appOrigin: appUrl.origin,
        project: testInfo.project.name,
        screenshots: screenshotNames,
        fixtureCleanup: cleanupSucceeded ? "passed" : "failed",
      }, null, 2)),
      contentType: "application/json",
    });
    expect(cleanupSucceeded, `Local fixture cleanup failed: ${cleanupErrors.join(", ")}`).toBe(true);
  }
});

async function createOverflowTags(admin: SupabaseClient, project: string, runId: string, registerTagIds: (ids: string[]) => void) {
  const tags = Array.from({ length: 50 }, (_, index) => ({
    id: randomUUID(),
    slug: `issue-49-${project}-${runId}-overflow-${index + 1}`,
    name: `Issue 49 ${project} ${runId} overflow tag ${index + 1}`,
  }));
  registerTagIds(tags.map(({ id }) => id));
  const insertedTags = await admin.from("tags").insert(tags.map(({ id, slug }) => ({ id, slug })));
  if (insertedTags.error) throw new Error("Could not create the isolated 50-tag database fixture.");
  const insertedTranslations = await admin.from("tag_translations").insert(tags.map(({ id, name }) => ({ tag_id: id, locale: "en", name })));
  if (insertedTranslations.error) throw new Error("Could not create the isolated tag translation fixture.");
  return tags;
}

function credentials(kind: string, runId: string) {
  return {
    email: `issue49-${kind}-${runId}@example.test`,
    password: `V!${randomUUID()}x9`,
  };
}

async function signInAs(page: Page, account: { email: string; password: string }) {
  await page.goto("/en/login?redirectTo=/admin");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
}

function productListContainer(page: Page, link: Locator, project: string) {
  return project === "chromium"
    ? page.getByRole("row").filter({ has: link })
    : page.locator("div.group.grid").filter({ has: link }).first();
}

async function saveScreenshot(page: Page, filename: string, target: Locator) {
  await mkdir(evidenceDirectory, { recursive: true });
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({ path: path.join(evidenceDirectory, filename), animations: "disabled" });
}

async function withAcceptedConfirmation(page: Page, action: () => Promise<void>) {
  const dialog = page.waitForEvent("dialog", { timeout: 5_000 });
  await Promise.all([dialog.then((value) => value.accept()), action()]);
}

async function expectProductSaveConfirmation(page: Page) {
  await expect(page.getByText(/^(?:Zapisano\. Zmiany są aktualne\.|Zapisano zmiany\.)$/)).toBeVisible();
}

function requireLoopbackUrl(raw: string | undefined, expectedPort: number, label: string) {
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new Error(`The ${label} URL is missing or invalid.`);
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    Number(url.port || "80") !== expectedPort ||
    url.username ||
    url.password
  ) {
    throw new Error(`The ${label} must use the expected HTTP loopback port ${expectedPort}.`);
  }
  return url;
}
