import type {
  AmazonLink,
  Category,
  Product,
  ProductAsset,
  Tag,
} from "./types";

const productIds = {
  moonGarden: "11111111-1111-4111-8111-111111111111",
  mindfulMandalas: "22222222-2222-4222-8222-222222222222",
  bedtimeForest: "33333333-3333-4333-8333-333333333333",
  draft: "44444444-4444-4444-8444-444444444444",
} as const;

export const categories: Category[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    slug: "coloring-books",
    sortOrder: 1,
    translations: [
      {
        locale: "en",
        name: "Coloring books",
        description: "Gentle coloring books for creative pauses.",
      },
      {
        locale: "pl",
        name: "Kolorowanki",
        description: "Spokojne kolorowanki na kreatywne chwile.",
      },
    ],
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    slug: "picture-books",
    sortOrder: 2,
    translations: [
      { locale: "en", name: "Picture books" },
      { locale: "pl", name: "Książki obrazkowe" },
    ],
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    slug: "mindfulness",
    sortOrder: 3,
    translations: [
      { locale: "en", name: "Mindfulness" },
      { locale: "pl", name: "Uważność" },
    ],
  },
];

export const tags: Tag[] = [
  {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    slug: "printable-bonus",
    translations: [
      { locale: "en", name: "Printable bonus" },
      { locale: "pl", name: "Bonus do druku" },
    ],
  },
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    slug: "amazon-kdp",
    translations: [
      { locale: "en", name: "Amazon KDP" },
      { locale: "pl", name: "Amazon KDP" },
    ],
  },
  {
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    slug: "calm-evening",
    translations: [
      { locale: "en", name: "Calm evening" },
      { locale: "pl", name: "Spokojny wieczór" },
    ],
  },
];

function asset(
  productId: string,
  id: string,
  kind: ProductAsset["kind"],
  path: string,
  filename: string,
  sortOrder: number,
  title: string,
  isPublic = true,
): ProductAsset {
  return {
    id,
    productId,
    kind,
    bucket: isPublic ? "public-media" : "premium-files",
    path,
    filename,
    contentType: filename.endsWith(".pdf")
      ? "application/pdf"
      : filename.endsWith(".mp4")
        ? "video/mp4"
        : "image/svg+xml",
    sizeBytes: 72_000,
    title,
    sortOrder,
    isPublic,
    demoDownloadPath: isPublic ? undefined : "/demo-premium/moon-garden-bonus.pdf",
  };
}

function amazonLink(
  id: string,
  productId: string,
  market: AmazonLink["market"],
  isPrimary: boolean,
): AmazonLink {
  const domain = market === "amazon.com" ? "www.amazon.com" : "www.amazon.de";
  const tracking = market === "amazon.com" ? "lamilialomi-20" : "lamilialomi-21";

  return {
    id,
    productId,
    market,
    isPrimary,
    url: `https://${domain}/dp/B0LAMIALOMI?tag=${tracking}`,
  };
}

export const products: Product[] = [
  {
    id: productIds.moonGarden,
    slug: "moon-garden-coloring-book",
    status: "published",
    audience: "kids",
    productType: "coloring-book",
    coverAssetId: "asset-moon-cover",
    videoAssetId: "asset-moon-video",
    reviewDelayDays: 14,
    sortOrder: 1,
    createdAt: "2026-04-20T10:00:00.000Z",
    updatedAt: "2026-05-30T10:00:00.000Z",
    translations: [
      {
        locale: "en",
        title: "Moon Garden Coloring Book",
        shortDescription:
          "A gentle nighttime coloring book for young dreamers and quiet family evenings.",
        longDescription:
          "Moon Garden invites children into a soft world of stars, little houses, sleepy flowers, and friendly night skies. The physical book unlocks premium printable pages and a calm bonus PDF for returning families.",
        seoTitle: "Moon Garden Coloring Book by LamiliaLomi",
        seoDescription:
          "Browse Moon Garden, a calm kids coloring book with printable premium bonuses unlocked by QR code.",
      },
      {
        locale: "pl",
        title: "Księżycowy Ogród. Kolorowanka",
        shortDescription:
          "Delikatna nocna kolorowanka dla dzieci i spokojnych rodzinnych wieczorów.",
        longDescription:
          "Księżycowy Ogród prowadzi dzieci przez świat gwiazd, małych domków, sennych kwiatów i łagodnego nieba. Książka papierowa odblokowuje dodatkowe strony do druku oraz bonusowy PDF.",
        seoTitle: "Księżycowy Ogród LamiliaLomi",
        seoDescription:
          "Sprawdź spokojną kolorowankę dla dzieci z materiałami premium odblokowywanymi kodem QR.",
      },
    ],
    categoryIds: [categories[0].id],
    tagIds: [tags[0].id, tags[1].id],
    assets: [
      asset(
        productIds.moonGarden,
        "asset-moon-cover",
        "cover",
        "/assets/covers/moon-garden.svg",
        "moon-garden.svg",
        1,
        "Moon Garden cover",
      ),
      asset(
        productIds.moonGarden,
        "asset-moon-gallery-1",
        "gallery",
        "/assets/gallery/moon-garden-page-1.svg",
        "moon-garden-page-1.svg",
        1,
        "Stars and little houses",
      ),
      asset(
        productIds.moonGarden,
        "asset-moon-gallery-2",
        "gallery",
        "/assets/gallery/moon-garden-page-2.svg",
        "moon-garden-page-2.svg",
        2,
        "Sleepy flower page",
      ),
      asset(
        productIds.moonGarden,
        "asset-moon-video",
        "video",
        "/assets/video/flipthrough-placeholder.svg",
        "flipthrough-placeholder.svg",
        1,
        "Flipthrough preview",
      ),
      asset(
        productIds.moonGarden,
        "asset-moon-premium-pdf",
        "premium_download",
        "moon-garden/bonus.pdf",
        "moon-garden-bonus.pdf",
        1,
        "Premium printable PDF",
        false,
      ),
    ],
    amazonLinks: [
      amazonLink("amazon-moon-us", productIds.moonGarden, "amazon.com", true),
      amazonLink("amazon-moon-de", productIds.moonGarden, "amazon.de", false),
    ],
    premiumCodes: [
      {
        id: "code-moon-2026",
        productId: productIds.moonGarden,
        code: "LOMI-BOOK-2026",
        active: true,
      },
    ],
  },
  {
    id: productIds.mindfulMandalas,
    slug: "mindful-mandalas-for-adults",
    status: "published",
    audience: "adults",
    productType: "coloring-book",
    coverAssetId: "asset-mandala-cover",
    reviewDelayDays: 21,
    sortOrder: 2,
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-05-20T10:00:00.000Z",
    translations: [
      {
        locale: "en",
        title: "Mindful Mandalas for Adults",
        shortDescription:
          "A slower coloring ritual for grown-ups who want a beautiful pause.",
        longDescription:
          "A premium-feeling adult coloring book with flowing mandalas, journaling prompts, and soft visual rhythm. Designed for calm evenings, gifting, and screen-free focus.",
      },
    ],
    categoryIds: [categories[0].id, categories[2].id],
    tagIds: [tags[0].id, tags[2].id],
    assets: [
      asset(
        productIds.mindfulMandalas,
        "asset-mandala-cover",
        "cover",
        "/assets/covers/mindful-mandalas.svg",
        "mindful-mandalas.svg",
        1,
        "Mindful Mandalas cover",
      ),
      asset(
        productIds.mindfulMandalas,
        "asset-mandala-gallery-1",
        "gallery",
        "/assets/gallery/mandala-page-1.svg",
        "mandala-page-1.svg",
        1,
        "Mandala interior",
      ),
    ],
    amazonLinks: [
      amazonLink("amazon-mandala-us", productIds.mindfulMandalas, "amazon.com", true),
    ],
    premiumCodes: [
      {
        id: "code-mandala-2026",
        productId: productIds.mindfulMandalas,
        code: "LOMI-CALM-2026",
        active: true,
      },
    ],
  },
  {
    id: productIds.bedtimeForest,
    slug: "bedtime-forest-picture-book",
    status: "published",
    audience: "kids",
    productType: "picture-book",
    coverAssetId: "asset-forest-cover",
    reviewDelayDays: 14,
    sortOrder: 3,
    createdAt: "2026-02-18T10:00:00.000Z",
    updatedAt: "2026-05-10T10:00:00.000Z",
    translations: [
      {
        locale: "en",
        title: "Bedtime Forest Picture Book",
        shortDescription:
          "A soft illustrated story for children who like gentle bedtime worlds.",
        longDescription:
          "Bedtime Forest is a quiet picture story with woodland paths, moonlit windows, and a friendly rhythm for nightly reading.",
      },
      {
        locale: "pl",
        title: "Dobranoc, Leśny Świecie",
        shortDescription:
          "Łagodna ilustrowana opowieść dla dzieci lubiących spokojne wieczory.",
        longDescription:
          "Dobranoc, Leśny Świecie to cicha opowieść obrazkowa z leśnymi ścieżkami, światłem w oknach i rytmem dobrym do wieczornego czytania.",
      },
    ],
    categoryIds: [categories[1].id],
    tagIds: [tags[1].id],
    assets: [
      asset(
        productIds.bedtimeForest,
        "asset-forest-cover",
        "cover",
        "/assets/covers/bedtime-forest.svg",
        "bedtime-forest.svg",
        1,
        "Bedtime Forest cover",
      ),
    ],
    amazonLinks: [
      amazonLink("amazon-forest-us", productIds.bedtimeForest, "amazon.com", true),
    ],
    premiumCodes: [
      {
        id: "code-forest-2026",
        productId: productIds.bedtimeForest,
        code: "LOMI-FOREST-2026",
        active: true,
      },
    ],
  },
  {
    id: productIds.draft,
    slug: "secret-draft-product",
    status: "draft",
    audience: "adults",
    productType: "audiobook",
    coverAssetId: "asset-draft-cover",
    reviewDelayDays: 14,
    sortOrder: 99,
    createdAt: "2026-05-30T10:00:00.000Z",
    updatedAt: "2026-05-30T10:00:00.000Z",
    translations: [
      {
        locale: "en",
        title: "Secret Draft Product",
        shortDescription: "Not public.",
        longDescription: "This seed exists to prove draft products stay hidden.",
      },
    ],
    categoryIds: [categories[2].id],
    tagIds: [],
    assets: [
      asset(
        productIds.draft,
        "asset-draft-cover",
        "cover",
        "/assets/covers/mindful-mandalas.svg",
        "mindful-mandalas.svg",
        1,
        "Draft cover",
      ),
    ],
    amazonLinks: [],
    premiumCodes: [],
  },
];

export const demoUsers = [
  {
    email: "demo@lamilialomi.test",
    role: "user" as const,
    emailVerified: true,
    marketingConsent: true,
    unlockedProductIds: [productIds.moonGarden],
  },
  {
    email: "unverified@lamilialomi.test",
    role: "user" as const,
    emailVerified: false,
    marketingConsent: false,
    unlockedProductIds: [],
  },
  {
    email: "admin@lamilialomi.test",
    role: "admin" as const,
    emailVerified: true,
    marketingConsent: true,
    unlockedProductIds: [productIds.moonGarden],
  },
];
