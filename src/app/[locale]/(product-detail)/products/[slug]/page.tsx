import { ArrowLeft, Download, FileText, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { AmazonLink } from "@/components/amazon-link";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { NavigationLink } from "@/components/navigation-link";
import { ProductDescription } from "@/components/product-description";
import { ProductInsideBookSection } from "@/components/product-inside-book-section";
import { ReaderArtworkGallery } from "@/components/reader-artwork-gallery";
import { getRichTextTextContent } from "@/lib/rich-text";
import { ScrollToFragment } from "@/components/scroll-to-fragment";
import { UnlockForm } from "@/components/unlock-form";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import { RichTextContent } from "@/components/rich-text-content";
import { isMediaProxyPath } from "@/lib/media-upload";
import {
  getAccountBoundResumeCode,
  readAuthResumeIntent,
} from "@/lib/auth-resume";
import { getUnlockIntent } from "@/lib/unlock-intent";
import { selectUnlockPrefillCode } from "@/lib/unlock-prefill";
import { getProductDetailAccessForRequest, getSupabaseAuthContext } from "@/lib/session.server";
import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import { createSignedDownloadUrl } from "@/lib/premium-core";
import {
  buildProductJsonLd,
  buildProductMetadata,
} from "@/lib/products";
import { getLocalizedProductDetailViewForRequest } from "@/lib/products-request";
import type { LocalizedProductView } from "@/lib/types";

type Props = {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = await getLocalizedProductDetailViewForRequest(slug, locale);

  if (!product) {
    return {
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  return buildProductMetadata(
    product,
    locale,
    getCanonicalAppUrl().origin,
  );
}

async function ProductUnlockSection({
  product,
  locale,
  error,
  alreadyUnlocked,
  verificationPending,
}: {
  product: LocalizedProductView;
  locale: Locale;
  error?: string;
  alreadyUnlocked: boolean;
  verificationPending: boolean;
}) {
  const [accessResult, unlockIntent, authResumeIntent, authContext, copy] = await Promise.all([
    getProductDetailAccessForRequest(product.id)
      .then((access) => ({ access }))
      .catch(() => ({ access: null })),
    getUnlockIntent(),
    readAuthResumeIntent(),
    getSupabaseAuthContext(),
    getTranslations("Funnel"),
  ]);
  const access = accessResult.access;
  const backendMode = getBackendMode();
  const accountBoundResumeCode = authContext.user
    ? getAccountBoundResumeCode(
        authResumeIntent,
        authContext.user,
        locale,
        product.slug,
      )
    : undefined;
  const initialCode = selectUnlockPrefillCode({
    currentIntent: unlockIntent,
    locale,
    productSlug: product.slug,
    backendMode,
    hasSupabaseUser: Boolean(authContext.user),
    accountBoundResumeCode,
  });
  const downloadLinks =
    access?.session?.emailVerified && access.isUnlocked
      ? product.premiumAssets
          .map((asset) => {
            if (backendMode === "local") {
              const session = access.localSession;
              const signed = session
                ? createSignedDownloadUrl({
                    asset,
                    product: { id: product.id, status: product.status },
                    session,
                  })
                : null;

              return signed?.ok ? { asset, href: signed.url } : null;
            }

            return {
              asset,
              href: `/api/downloads/${asset.id}?locale=${locale}&returnTo=${encodeURIComponent(`/${locale}/products/${product.slug}`)}`,
            };
          })
          .filter((link): link is NonNullable<typeof link> => Boolean(link))
      : [];

  return (
    <section
      id="premium"
      aria-labelledby="premium-title"
      className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
      data-testid="product-unlock-section"
    >
      <ScrollToFragment targetId="premium" />
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-sm font-medium text-[var(--color-terracotta)]">
            {copy("ownerEyebrow")}
          </p>
          <h2 id="premium-title" className="mt-2 font-serif text-3xl font-semibold">
            {copy("ownerTitle")}
          </h2>
          <p className="mt-4 text-[var(--color-muted)]">
            {copy("ownerDescription")}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-white/75 p-5">
          {access ? (
            <>
              <UnlockForm
                locale={locale}
                productSlug={product.slug}
                initialCode={initialCode}
                session={access.session}
                isUnlocked={access.isUnlocked}
                isDemo={backendMode === "local"}
                error={error}
                alreadyUnlocked={alreadyUnlocked}
                verificationPending={verificationPending}
                copy={{
                  loginRequired: copy("loginRequired"),
                  loginRequiredDescription: copy("loginRequiredDescription"),
                  verificationRequired: copy("verificationRequired"),
                  verificationRequiredDescription: copy("verificationRequiredDescription"),
                  verificationPending: copy("verificationPending"),
                  verificationPendingDescription: copy("verificationPendingDescription"),
                  verificationPendingDemo: copy("verificationPendingDemo"),
                  verificationPendingDemoDescription: copy("verificationPendingDemoDescription"),
                  resendVerification: copy("resendVerification"),
                  continueDemoVerification: copy("continueDemoVerification"),
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
                    already_used: copy("already_used"),
                    wrong_product: copy("wrong_product"),
                    product_not_found: copy("product_not_found"),
                    unexpected: copy("unexpected"),
                  },
                }}
              />
              {downloadLinks.length ? (
                <div className="mt-5 grid gap-3" data-testid="premium-download-links">
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
            </>
          ) : (
            <p className="rounded-lg bg-[var(--color-error-bg)] p-4 text-sm leading-6 text-[var(--color-error)]" role="alert">
              {copy("unexpected")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ProductUnlockLoading() {
  return (
    <section
      id="premium"
      aria-busy="true"
      aria-label="Loading product access"
      aria-live="polite"
      className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
      data-testid="product-unlock-loading"
    >
      <span className="sr-only">Loading product access</span>
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <div className="h-4 w-32 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="h-9 w-3/4 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="h-20 w-full animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
        </div>
        <div className="min-h-52 rounded-lg border border-[var(--color-border)] bg-white/75 p-5">
          <div className="h-6 w-2/3 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-5 h-10 w-full animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-4 h-11 w-40 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
        </div>
      </div>
    </section>
  );
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  const query = await searchParams;
  const code = stringParam(query.code) ?? stringParam(query.premiumCode);
  const error = stringParam(query.unlock);
  const product = await getLocalizedProductDetailViewForRequest(slug, locale);

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

  const productCopy = await getTranslations("Product");
  const galleryImages = product.gallery.map((asset) => ({
    id: asset.id,
    path: asset.path,
    alt: asset.title ?? product.title,
    caption: getGalleryCaption(asset.title, asset.filename, product.title),
    unoptimized: isMediaProxyPath(asset.path),
  }));
  const galleryLabels = {
    moreImages: "more",
    viewAllImages: `View all ${product.gallery.length} pages`,
    previewTitle: productCopy("imagePreview"),
    closePreview: productCopy("closeImagePreview"),
    previousImage: productCopy("previousImage"),
    nextImage: productCopy("nextImage"),
    openImages: product.gallery.map((_, index) =>
      productCopy("openImage", { index: index + 1 }),
    ),
    imagePositions: product.gallery.map((_, index) =>
      productCopy("imageCounter", {
        current: index + 1,
        total: product.gallery.length,
      }),
    ),
  };
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
      <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
        <NavigationLink
          href={`/${locale}/products`}
          pendingLabel="Opening catalog"
          className={buttonClassName({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to catalog
        </NavigationLink>
      </div>
      <section data-testid="product-hero" className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-12 lg:px-8">
        <div className="min-w-0">
          <div className="relative mx-auto aspect-[8.5/11] w-full max-w-[360px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-blush)] shadow-[0_18px_46px_rgba(62,52,47,0.12)] lg:mx-0">
            <ImageWithFallback
              src={product.cover.path}
              alt={product.cover.title ?? product.title}
              loading="eager"
              className="object-contain"
              sizes="(min-width: 392px) 360px, calc(100vw - 32px)"
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-center">
          <div className="flex flex-wrap gap-2">
            <Badge>{product.audienceLabel}</Badge>
            {product.categories.map((category) => (
              <Badge key={category.id} className="gap-2 bg-white/85">
                {category.image ? <span className="relative size-5 overflow-hidden rounded-full bg-[var(--color-bg)]"><ImageWithFallback src={category.image.path} alt="" className="object-contain" sizes="20px" /></span> : null}
                {category.name}
              </Badge>
            ))}
          </div>
          <h1 className="mt-4 break-words font-serif text-3xl font-semibold leading-tight sm:text-4xl">
            {product.title}
          </h1>
          {product.shortDescription ? <RichTextContent value={product.shortDescription} className="mt-4 max-w-2xl space-y-3 text-lg leading-7 text-[var(--color-muted)]" /> : null}
          <div data-testid="product-primary-actions" className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
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
          {product.longDescription ? (
            <div className="mt-6 border-t border-[var(--color-border)] pt-5">
              <ProductDescription previewText={getRichTextTextContent(product.longDescription)} readMore="Read more" showLess="Show less">
                <RichTextContent value={product.longDescription} className="max-w-2xl space-y-3 text-base leading-7 text-[var(--color-muted)]" />
              </ProductDescription>
            </div>
          ) : null}
        </div>
      </section>

      <ProductInsideBookSection
        title={productCopy("insideBookTitle")}
        description={productCopy("insideBookDescription")}
        images={galleryImages}
        labels={galleryLabels}
        video={product.video}
        poster={product.cover.path}
      />
      <ReaderArtworkGallery artworks={product.readerArtworks} />

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

      <Suspense fallback={<ProductUnlockLoading />}>
        <ProductUnlockSection
          product={product}
          locale={locale}
          error={error}
          alreadyUnlocked={stringParam(query.unlocked) === "already"}
          verificationPending={stringParam(query.step) === "verify"}
        />
      </Suspense>
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

function getGalleryCaption(
  title: string | undefined,
  filename: string,
  productTitle: string,
) {
  const value = title?.trim();

  if (!value) return null;

  const normalizedValue = value.toLocaleLowerCase();
  if (
    normalizedValue === filename.trim().toLocaleLowerCase() ||
    normalizedValue === productTitle.trim().toLocaleLowerCase()
  ) {
    return null;
  }

  return value;
}
