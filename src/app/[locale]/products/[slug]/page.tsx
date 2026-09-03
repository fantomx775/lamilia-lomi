import { Download, LockKeyhole, PlayCircle } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";

import { AmazonLink } from "@/components/amazon-link";
import { UnlockForm } from "@/components/unlock-form";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import { getUnlockIntent } from "@/lib/unlock-intent";
import { getDemoSession } from "@/lib/session.server";
import {
  buildProductJsonLd,
  buildProductMetadata,
} from "@/lib/products";
import { getLocalizedProductViewForRequest } from "@/lib/products-request";

type Props = {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = await getLocalizedProductViewForRequest(slug, locale);

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
  const code = stringParam(query.code) ?? stringParam(query.premiumCode);
  const error = stringParam(query.unlock);
  const [product, session] = await Promise.all([
    getLocalizedProductViewForRequest(slug, locale),
    getDemoSession(),
  ]);

  if (!product) {
    notFound();
  }

  if (code?.trim()) {
    const unlockParams = new URLSearchParams({ code });
    const step = stringParam(query.step);

    if (step) {
      unlockParams.set("step", step.slice(0, 128));
    }

    redirect(
      `/api/unlock/${locale}/${product.slug}?${unlockParams.toString()}`,
    );
  }

  const unlockIntent = await getUnlockIntent();
  const hasCurrentIntent =
    unlockIntent?.locale === locale && unlockIntent.productSlug === product.slug;

  const isUnlocked = session?.unlockedProductIds.includes(product.id) ?? false;
  const copy = await getTranslations("Funnel");
  const initialCode =
    hasCurrentIntent ? unlockIntent?.code : undefined;
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
              {copy("ownerEyebrow")}
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold">
              {copy("ownerTitle")}
            </h2>
            <p className="mt-4 text-[var(--color-muted)]">
              {copy("ownerDescription")}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-white/75 p-5">
            <UnlockForm
              locale={locale}
              productSlug={product.slug}
              productId={product.id}
              initialCode={initialCode}
              session={session}
              error={error}
              alreadyUnlocked={stringParam(query.unlocked) === "already"}
              copy={{
                loginRequired: copy("loginRequired"),
                loginRequiredDescription: copy("loginRequiredDescription"),
                verificationRequired: copy("verificationRequired"),
                verificationRequiredDescription: copy("verificationRequiredDescription"),
                verifyDemo: copy("verifyDemo"),
                codeLabel: copy("codeLabel"),
                codePlaceholder: copy("codePlaceholder"),
                unlock: copy("unlock"),
                pending: copy("pending"),
                login: copy("login"),
                register: copy("register"),
                success: copy("success"),
                already: copy("already"),
                successDescription: copy("successDescription"),
                goLibrary: copy("goLibrary"),
                errors: {
                  missing_code: copy("missing_code"),
                  invalid_code: copy("invalid_code"),
                  inactive_code: copy("inactive_code"),
                  product_not_found: copy("product_not_found"),
                  unexpected: copy("unexpected"),
                },
              }}
            />
            {isUnlocked && product.premiumAssets.length ? (
              <div className="mt-5 grid gap-3">
                {product.premiumAssets.map((asset) => (
                  <a
                    key={asset.id}
                    className={buttonClassName({ variant: "secondary", className: "w-full" })}
                    href={`/api/downloads/${asset.id}?locale=${locale}&returnTo=${encodeURIComponent(`/${locale}/products/${product.slug}`)}`}
                  >
                    <Download className="size-4" aria-hidden />
                    {asset.title ?? copy("download")}
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

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
