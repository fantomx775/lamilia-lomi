import { ChevronDown, Filter, Search } from "lucide-react";
import { Suspense } from "react";

import { CategoryTileImage } from "@/components/category-tile-image";
import { NavigationLink } from "@/components/navigation-link";
import { ProductCatalogLoading } from "@/components/product-catalog-loading";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/routing";
import { getPublicCatalogSnapshotForRequest } from "@/lib/content-repository";
import {
  getAllProductTypesFromSnapshot,
  getCatalogProductsFromSnapshot,
  getTranslation,
  parseCatalogFilters,
} from "@/lib/products";

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ProductsPage(props: Props) {
  return (
    <Suspense fallback={<ProductCatalogLoading />}>
      <ProductsPageContent {...props} />
    </Suspense>
  );
}

async function ProductsPageContent({ params, searchParams }: Props) {
  const { locale } = await params;
  const rawSearchParams = await searchParams;
  const filters = parseCatalogFilters(rawSearchParams);
  await delayCatalogForE2E();
  const snapshot = await getPublicCatalogSnapshotForRequest(locale);
  const products = getCatalogProductsFromSnapshot(snapshot, locale, filters);
  const categories = snapshot.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((category) => {
      const translation = getTranslation(category.translations, locale);

      return translation
        ? [{ id: category.id, slug: category.slug, name: translation.name, image: category.image }]
        : [];
    });
  const tags = snapshot.tags.flatMap((tag) => {
    const translation = getTranslation(tag.translations, locale);

    return translation ? [{ slug: tag.slug, name: translation.name }] : [];
  });
  const productTypes = getAllProductTypesFromSnapshot(snapshot);
  const desktopColumnClass = {
    3: "xl:grid-cols-3",
    4: "xl:grid-cols-4",
    5: "xl:grid-cols-5",
  }[snapshot.catalogSettings.desktopColumns];
  const imageSizes =
    "(min-width: 1280px) " +
    Math.round(100 / snapshot.catalogSettings.desktopColumns) +
    "vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";
  const categoryName = categories.find((category) => category.slug === filters.category)?.name;
  const tagName = tags.find((tag) => tag.slug === filters.tag)?.name;
  const activeFilterLabels = [
    filters.audience ? `Audience: ${filters.audience === "kids" ? "Kids" : "Adults"}` : null,
    filters.productType ? `Type: ${filters.productType}` : null,
    filters.category ? `Category: ${categoryName ?? filters.category}` : null,
    filters.tag ? `Tag: ${tagName ?? filters.tag}` : null,
    filters.sort !== "manual" ? `Sort: ${filters.sort === "newest" ? "Newest" : "A-Z"}` : null,
  ].filter((value): value is string => value !== null);
  const activeFilterCount = activeFilterLabels.length;
  const hasActiveFilters = Boolean(filters.q || activeFilterCount);
  const hiddenFilterValues = [
    { name: "audience", value: filters.audience },
    { name: "type", value: filters.productType },
    { name: "category", value: filters.category },
    { name: "tag", value: filters.tag },
    { name: "sort", value: Object.hasOwn(rawSearchParams, "sort") ? filters.sort : undefined },
  ];
  const preservedQueryInputs = getPreservedQueryInputs(rawSearchParams);
  const clearFiltersHref = getCatalogHref(locale, rawSearchParams, { clearFilters: true });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="max-w-3xl">
        <p className="text-sm font-medium text-[var(--color-terracotta)]">Catalog</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold sm:mt-2 sm:text-4xl">Browse LamiliaLomi books</h1>
        <p className="mt-2 text-[var(--color-muted)] sm:mt-4">
          Search published products, filter by audience and taxonomy, and open a
          product to unlock premium materials.
        </p>
      </div>

      {categories.length ? (
        <section aria-label="Categories" className="mt-5 sm:mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-serif text-xl font-semibold sm:text-2xl">Categories</h2>
            {filters.category ? <NavigationLink pendingLabel="Clearing category filter" href={getCatalogHref(locale, rawSearchParams, { category: null })} className="hidden text-sm text-[var(--color-terracotta)] underline-offset-4 hover:underline md:inline-flex">Clear category</NavigationLink> : null}
          </div>
          <div data-testid="catalog-category-list" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-3 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-4 xl:grid-cols-6">
            <NavigationLink
              data-testid="catalog-category-all"
              href={getCatalogHref(locale, rawSearchParams, { category: null })}
              aria-current={!filters.category ? "true" : undefined}
              className={`flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] md:hidden ${!filters.category ? "border-[var(--color-terracotta)] bg-[var(--color-blush)] text-[var(--color-ink)]" : "border-[var(--color-border)] bg-white/80 text-[var(--color-muted)]"}`}
              pendingLabel="Showing all categories"
            >
              All categories
            </NavigationLink>
            {categories.map((category) => (
              <NavigationLink
                key={category.id}
                data-testid={`catalog-category-${category.slug}`}
                href={getCatalogHref(locale, rawSearchParams, { category: category.slug })}
                aria-current={filters.category === category.slug ? "true" : undefined}
                className={`group flex min-h-10 w-fit shrink-0 items-center rounded-full border px-4 text-sm font-medium transition hover:border-[var(--color-terracotta)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] md:grid md:min-h-0 md:w-auto md:min-w-0 md:grid-cols-[3.5rem_minmax(0,1fr)] md:gap-3 md:rounded-lg md:p-3 ${filters.category === category.slug ? "border-[var(--color-terracotta)] bg-[var(--color-blush)] text-[var(--color-ink)]" : "border-[var(--color-border)] bg-white/80 text-[var(--color-muted)]"}`}
                pendingLabel={`Opening ${category.name} products`}
              >
                <span className="relative hidden aspect-square overflow-hidden rounded-md md:block">
                  <CategoryTileImage src={category.image?.path} />
                </span>
                <span className="whitespace-nowrap md:line-clamp-2 md:whitespace-normal md:text-[var(--color-ink)] md:group-hover:text-[var(--color-terracotta)]">{category.name}</span>
              </NavigationLink>
            ))}
          </div>
        </section>
      ) : null}

      <form action={`/${locale}/products`} method="get" data-testid="catalog-mobile-search" className="mt-4 flex items-center gap-2 md:hidden">
        {preservedQueryInputs}
        {hiddenFilterValues.map(({ name, value }) => value ? <input key={name} type="hidden" name={name} value={value} /> : null)}
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
          <Input aria-label="Search catalog" name="q" placeholder="Search" defaultValue={filters.q ?? ""} className="pl-9" />
        </label>
        <Button type="submit" size="sm" className="h-11 px-3">
          <Search className="size-4" aria-hidden />
          Search
        </Button>
      </form>

      <details data-testid="catalog-mobile-filter-disclosure" className="group mt-2 rounded-lg border border-[var(--color-border)] bg-white/65 md:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <Filter className="size-4" aria-hidden />
            Filters
            {activeFilterCount ? <span className="rounded-full bg-[var(--color-sage)] px-2 py-0.5 text-xs">{activeFilterCount}<span className="sr-only"> active filters</span></span> : null}
          </span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
        </summary>
        <form action={`/${locale}/products`} method="get" data-testid="catalog-mobile-filters" className="border-t border-[var(--color-border)] p-3">
          {preservedQueryInputs}
          {filters.q ? <input type="hidden" name="q" value={filters.q} /> : null}
          {activeFilterLabels.length ? (
            <div className="flex flex-wrap gap-2" aria-label="Active filters">
              {activeFilterLabels.map((label) => <span key={label} className="rounded-full bg-[var(--color-sage)]/70 px-2.5 py-1 text-xs text-[var(--color-ink-soft)]">{label}</span>)}
            </div>
          ) : <p className="text-xs text-[var(--color-muted)]">No active filters</p>}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {renderCatalogFilterFields({ filters, categories, tags, productTypes })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm">
              <Filter className="size-4" aria-hidden />
              Apply filters
            </Button>
            {hasActiveFilters ? <NavigationLink href={clearFiltersHref} pendingLabel="Clearing catalog filters" className="text-sm font-medium text-[var(--color-terracotta)] underline-offset-4 hover:underline">Clear all</NavigationLink> : null}
          </div>
        </form>
      </details>

      <form action={`/${locale}/products`} method="get" data-testid="catalog-desktop-filters" className="mt-8 hidden gap-3 rounded-lg border border-[var(--color-border)] bg-white/65 p-4 md:grid md:grid-cols-[1.2fr_repeat(5,minmax(0,1fr))_auto]">
        {preservedQueryInputs}
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
          <Input aria-label="Search catalog" name="q" placeholder="Search" defaultValue={filters.q ?? ""} className="pl-9" />
        </label>
        {renderCatalogFilterFields({ filters, categories, tags, productTypes })}
        <div className="flex items-center gap-3">
          <Button type="submit">
            <Filter className="size-4" aria-hidden />
            Apply
          </Button>
          {hasActiveFilters ? <NavigationLink href={clearFiltersHref} pendingLabel="Clearing catalog filters" className="text-sm font-medium text-[var(--color-terracotta)] underline-offset-4 hover:underline">Clear all</NavigationLink> : null}
        </div>
      </form>

      {products.length ? (
        <div
          data-testid="product-catalog-grid"
          className={[
            "mt-5 grid gap-4 sm:grid-cols-2 sm:gap-5 md:mt-8 lg:grid-cols-3 lg:gap-6",
            desktopColumnClass,
          ].join(" ")}
        >
          {products.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              locale={locale}
              imageLoading={index === 0 ? "eager" : "lazy"}
              imageSizes={imageSizes}
            />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-white/70 p-8 text-center md:mt-8">
          <p className="font-serif text-2xl font-semibold">No products found</p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Try clearing search or choosing a broader audience.
          </p>
          <NavigationLink pendingLabel="Opening catalog" className="mt-5 inline-flex text-sm font-medium text-[var(--color-terracotta)]" href={`/${locale}/products`}>
            Reset catalog
          </NavigationLink>
        </div>
      )}
    </div>
  );
}

function renderCatalogFilterFields({
  filters,
  categories,
  tags,
  productTypes,
}: {
  filters: ReturnType<typeof parseCatalogFilters>;
  categories: Array<{ slug: string; name: string }>;
  tags: Array<{ slug: string; name: string }>;
  productTypes: string[];
}) {
  const selectClassName = "h-11 min-w-0 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]";

  return (
    <>
      <select name="audience" aria-label="Audience filter" defaultValue={filters.audience ?? ""} className={selectClassName}>
        <option value="">Audience</option>
        <option value="kids">Kids</option>
        <option value="adults">Adults</option>
      </select>
      <select name="type" aria-label="Type filter" defaultValue={filters.productType ?? ""} className={selectClassName}>
        <option value="">Type</option>
        {productTypes.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <select name="category" aria-label="Category filter" defaultValue={filters.category ?? ""} className={selectClassName}>
        <option value="">Category</option>
        {categories.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
      </select>
      <select name="tag" aria-label="Tag filter" defaultValue={filters.tag ?? ""} className={selectClassName}>
        <option value="">Tag</option>
        {tags.map((tag) => <option key={tag.slug} value={tag.slug}>{tag.name}</option>)}
      </select>
      <select name="sort" aria-label="Sort products" defaultValue={filters.sort} className={selectClassName}>
        <option value="manual">Manual</option>
        <option value="newest">Newest</option>
        <option value="az">A-Z</option>
      </select>
    </>
  );
}

type CatalogSearchParams = Record<string, string | string[] | undefined>;

function getCatalogHref(
  locale: Locale,
  searchParams: CatalogSearchParams,
  options: { category?: string | null; clearFilters?: boolean } = {},
) {
  const query = new URLSearchParams();

  for (const [name, value] of Object.entries(searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(name, item);
    }
  }

  if (options.clearFilters) {
    for (const name of ["q", "audience", "type", "category", "tag", "sort"]) query.delete(name);
  } else if (options.category === null) {
    query.delete("category");
  } else if (typeof options.category === "string") {
    query.set("category", options.category);
  }

  const queryString = query.toString();
  return `/${locale}/products${queryString ? `?${queryString}` : ""}`;
}

function getPreservedQueryInputs(searchParams: CatalogSearchParams) {
  const managedParams = new Set(["q", "audience", "type", "category", "tag", "sort"]);

  return Object.entries(searchParams).flatMap(([name, value]) => {
    if (managedParams.has(name)) return [];

    return (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((item, index) => (
      <input key={`${name}-${index}`} type="hidden" name={name} value={item} />
    ));
  });
}

async function delayCatalogForE2E() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.LAMILIA_BACKEND?.trim().toLowerCase() !== "local"
  ) {
    return;
  }

  const delayMs = Number(process.env.LAMILIA_TEST_CATALOG_LOADING_DELAY_MS);

  if (!Number.isSafeInteger(delayMs) || delayMs < 1 || delayMs > 5_000) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
