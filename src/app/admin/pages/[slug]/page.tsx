import { notFound } from "next/navigation";

import { saveAboutPageAction, saveStaticPagesAction } from "@/app/admin/actions";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { formatAdminErrors } from "@/lib/admin-errors";
import { getTranslation } from "@/lib/products";
import { AboutPageEditor } from "../about-page-editor";
import { PageEditor } from "../page-editor";
import { AdminRouteToast } from "@/components/admin/admin-toast";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditPage({ params, searchParams }: Props) {
  const { slug } = await params;
  if (slug !== "about" && slug !== "privacy" && slug !== "terms") {
    notFound();
  }

  const query = await searchParams;
  const error = query.error ? formatAdminErrors(query.error, "pl") : undefined;
  const toastId = typeof query.toast === "string" && /^[0-9a-f-]{36}$/i.test(query.toast) ? query.toast : undefined;
  const snapshot = await getAdminContentSnapshot();

  if (slug === "about") {
    const products = snapshot.products.map((product) => {
      const translation = getTranslation(product.translations, "en")
        ?? product.translations[0];

      return {
        id: product.id,
        title: translation?.title || product.slug,
        subtitle: translation?.shortDescription || undefined,
        productType: product.productType,
        status: product.status,
      };
    });

    return (
      <>
      <AboutPageEditor
        config={snapshot.aboutPageSettings}
        products={products}
        feedback={error}
        saved={Boolean(toastId && !error)}
        saveAction={saveAboutPageAction}
      />
      <AdminRouteToast eventId={toastId} kind={error ? "error" : "success"} message={error ?? "Zmiany strony zostały zapisane."} cleanPath={`/admin/pages/${slug}`} />
      </>
    );
  }

  const records = snapshot.staticPages.filter(
    (page) => page.slug === slug,
  );

  const saveAction = saveStaticPagesAction.bind(null, slug);

  return <><PageEditor slug={slug} title={records.find((record) => record.locale === "en")?.title ?? slug} records={records} feedback={error} saved={Boolean(toastId && !error)} saveAction={saveAction} /><AdminRouteToast eventId={toastId} kind={error ? "error" : "success"} message={error ?? "Zmiany strony zostały zapisane."} cleanPath={`/admin/pages/${slug}`} /></>;
}
