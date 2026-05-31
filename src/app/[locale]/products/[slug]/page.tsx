import { Download, LockKeyhole, PlayCircle } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { AmazonLink } from "@/components/amazon-link";
import { UnlockForm } from "@/components/unlock-form";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import { getDemoSession } from "@/lib/session.server";
import {
  buildProductJsonLd,
  buildProductMetadata,
  getLocalizedProductView,
} from "@/lib/products";

type Props = {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = getLocalizedProductView(slug, locale);

  if (!product) {
    return {};
  }

  return buildProductMetadata(
    product,
    locale,
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  );
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  const query = await searchParams;
  const code = Array.isArray(query.code) ? query.code[0] : query.code;
  const product = getLocalizedProductView(slug, locale);
  const session = await getDemoSession();

  if (!product) {
    notFound();
  }

  const isUnlocked = session?.unlockedProductIds.includes(product.id) ?? false;
  const jsonLd = buildProductJsonLd(
    product,
    locale,
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  );

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
        <div className="space-y-5">
          <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-blush)] shadow-[0_18px_46px_rgba(62,52,47,0.12)]">
            <Image
              src={product.cover.path}
              alt={product.cover.title ?? product.title}
              fill
              priority
              className="object-cover"
              sizes="(min-width: 1024px) 38vw, 100vw"
            />
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <div className="flex flex-wrap gap-2">
            <Badge>{product.audienceLabel}</Badge>
            {product.categories.map((category) => (
              <Badge key={category.id} className="bg-white/85">
                {category.name}
              </Badge>
            ))}
          </div>
          <h1 className="mt-5 font-serif text-4xl font-semibold leading-tight sm:text-5xl">
            {product.title}
          </h1>
          <p className="mt-5 text-lg leading-8 text-[var(--color-muted)]">
            {product.longDescription}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {product.primaryAmazonLink ? (
              <AmazonLink
                href={product.primaryAmazonLink.url}
                productId={product.id}
                market={product.primaryAmazonLink.market}
              >
                View on Amazon
              </AmazonLink>
            ) : null}
            <a
              href="#premium"
              className={buttonClassName({ variant: "outline" })}
            >
              <LockKeyhole className="size-4" aria-hidden />
              Premium materials
            </a>
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--color-border)] bg-white/50">
        <div className="mx-auto grid max-w-7xl gap-5 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_1fr] lg:px-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {product.gallery.map((asset) => (
              <div key={asset.id} className="relative aspect-[4/3] overflow-hidden rounded-lg border border-[var(--color-border)] bg-white">
                <Image src={asset.path} alt={asset.title ?? product.title} fill className="object-cover" />
              </div>
            ))}
          </div>
          <div className="relative grid min-h-72 place-items-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-alt)]">
            {product.video ? (
              <Image src={product.video.path} alt={product.video.title ?? "Video preview"} fill className="object-cover" />
            ) : null}
            <div className="relative z-10 flex items-center gap-2 rounded-md bg-white/82 px-4 py-3 text-sm font-medium">
              <PlayCircle className="size-5 text-[var(--color-terracotta)]" />
              Public flipthrough video
            </div>
          </div>
        </div>
      </section>

      <section id="premium" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-medium text-[var(--color-terracotta)]">
              Premium
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold">
              Unlock product-specific files
            </h2>
            <p className="mt-4 text-[var(--color-muted)]">
              Premium access is stored per user and product. The demo mode uses
              a secure HTTP-only cookie; production mode is ready for Supabase
              Auth, RLS, and private Storage signed URLs.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-white/75 p-5">
            <UnlockForm
              locale={locale}
              productSlug={product.slug}
              productId={product.id}
              initialCode={code}
              session={session}
            />
            {isUnlocked && product.premiumAssets.length ? (
              <div className="mt-5 grid gap-3">
                {product.premiumAssets.map((asset) => (
                  <a
                    key={asset.id}
                    className={buttonClassName({ variant: "secondary", className: "w-full" })}
                    href={`/api/downloads/${asset.id}`}
                  >
                    <Download className="size-4" aria-hidden />
                    {asset.title ?? "Download premium file"}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
