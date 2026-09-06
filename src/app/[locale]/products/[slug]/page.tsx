import { Download, FileText, LockKeyhole, PlayCircle } from "lucide-react";
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
import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import { createSignedDownloadUrl } from "@/lib/premium-core";
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
    getCanonicalAppUrl().origin,
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
  const backendMode = getBackendMode();
  const localDownloadUrls = new Map<string, string>();

  if (backendMode === "local" && session?.emailVerified && isUnlocked) {
    for (const asset of product.premiumAssets) {
      const signedUrl = createSignedDownloadUrl({
        asset,
        product: { id: product.id, status: product.status },
        session,
      });

      if (signedUrl.ok) {
        localDownloadUrls.set(asset.id, signedUrl.url);
      }
    }
  }

  const downloadLinks = product.premiumAssets
    .map((asset) => ({
      asset,
      href:
        backendMode === "local"
          ? localDownloadUrls.get(asset.id)
          : `/api/downloads/${asset.id}?locale=${locale}&returnTo=${encodeURIComponent(`/${locale}/products/${product.slug}`)}`,
    }))
    .filter((link): link is { asset: (typeof product.premiumAssets)[number]; href: string } => Boolean(link.href));

  const copy = await getTranslations("Funnel");
  const productCopy = await getTranslations("Product");
  const initialCode =
    hasCurrentIntent ? unlockIntent?.code : undefined;
  const jsonLd = buildProductJsonLd(
    product,
    locale,
    getCanonicalAppUrl().origin,
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
              <video
                src={product.video.path}
                controls
                preload="metadata"
                className="absolute inset-0 size-full object-cover"
                aria-label={product.video.title ?? "Video preview"}
              />
            ) : null}
            <div className="pointer-events-none relative z-10 flex items-center gap-2 rounded-md bg-white/82 px-4 py-3 text-sm font-medium">
              <PlayCircle className="size-5 text-[var(--color-terracotta)]" />
              Public flipthrough video
            </div>
          </div>
        </div>
      </section>

      {product.publicDownloads.length ? (
        <section aria-labelledby="public-downloads-title" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-[var(--color-terracotta)]">{productCopy("availableNow")}</p>
                <h2 id="public-downloads-title" className="mt-2 font-serif text-3xl font-semibold">{productCopy("publicDownloads")}</h2>
                <p className="mt-3 max-w-2xl text-[var(--color-muted)]">{productCopy("publicDownloadsDescription")}</p>
              </div>
              <Download className="size-7 text-[var(--color-terracotta)]" aria-hidden />
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {product.publicDownloads.map((asset) => (
                <a key={asset.id} href={`/api/media/${asset.id}?download=1`} className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 transition hover:border-[var(--color-terracotta)] hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">
                  <span className="flex min-w-0 items-center gap-3">
                    <FileText className="size-5 shrink-0 text-[var(--color-terracotta)]" aria-hidden />
                    <span className="min-w-0">
                      <span className="block break-words font-medium">{asset.title || asset.filename}</span>
                      {asset.sizeBytes ? <span className="mt-1 block text-xs text-[var(--color-muted)]">{formatBytes(asset.sizeBytes)}</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-[var(--color-terracotta)]">{productCopy("downloadPublic")}</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

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
            {session?.emailVerified && isUnlocked && product.premiumAssets.length ? (
              <div className="mt-5 grid gap-3">
                {downloadLinks.map(({ asset, href }) => (
                  <a
                    key={asset.id}
                    className={buttonClassName({ variant: "secondary", className: "w-full" })}
                    href={href}
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
