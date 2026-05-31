import { Filter, Search } from "lucide-react";
import Link from "next/link";

import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/routing";
import {
  getAllProductTypes,
  getCatalogProducts,
  getCategoryOptions,
  getTagOptions,
  parseCatalogFilters,
} from "@/lib/products";

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProductsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const filters = parseCatalogFilters(await searchParams);
  const products = getCatalogProducts(locale, filters);
  const categories = getCategoryOptions(locale);
  const tags = getTagOptions(locale);
  const productTypes = getAllProductTypes();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="max-w-3xl">
        <p className="text-sm font-medium text-[var(--color-terracotta)]">Catalog</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold">Browse LamiliaLomi books</h1>
        <p className="mt-4 text-[var(--color-muted)]">
          Search published products, filter by audience and taxonomy, and open a
          product to unlock premium materials.
        </p>
      </div>

      <form className="mt-8 grid gap-3 rounded-lg border border-[var(--color-border)] bg-white/65 p-4 md:grid-cols-[1.2fr_repeat(5,minmax(0,1fr))_auto]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
          <Input name="q" placeholder="Search" defaultValue={filters.q ?? ""} className="pl-9" />
        </label>
        <select name="audience" defaultValue={filters.audience ?? ""} className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">
          <option value="">Audience</option>
          <option value="kids">Kids</option>
          <option value="adults">Adults</option>
        </select>
        <select name="type" defaultValue={filters.productType ?? ""} className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">
          <option value="">Type</option>
          {productTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={filters.category ?? ""} className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">
          <option value="">Category</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
        <select name="tag" defaultValue={filters.tag ?? ""} className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">
          <option value="">Tag</option>
          {tags.map((tag) => (
            <option key={tag.slug} value={tag.slug}>
              {tag.name}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={filters.sort} className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">
          <option value="manual">Manual</option>
          <option value="newest">Newest</option>
          <option value="az">A-Z</option>
        </select>
        <Button type="submit">
          <Filter className="size-4" aria-hidden />
          Apply
        </Button>
      </form>

      {products.length ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} locale={locale} />
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-lg border border-[var(--color-border)] bg-white/70 p-8 text-center">
          <p className="font-serif text-2xl font-semibold">No products found</p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Try clearing search or choosing a broader audience.
          </p>
          <Link className="mt-5 inline-flex text-sm font-medium text-[var(--color-terracotta)]" href={`/${locale}/products`}>
            Reset catalog
          </Link>
        </div>
      )}
    </div>
  );
}
