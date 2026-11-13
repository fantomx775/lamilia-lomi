import { Suspense } from "react";
import Link from "next/link";
import { getCommunityAdminAccess } from "@/lib/community/admin-http";
import { supportsCommunityAvatars } from "@/lib/community/avatar-repository";
import { getCommunityModerationArtwork, listCommunityModerationQueue, listCommunityModerationProductOptions } from "@/lib/community/repository";
import CommunityModeration from "./community-moderation";

export const dynamic = "force-dynamic";

export default async function AdminCommunityPage({ searchParams }: { searchParams?: Promise<{ status?: string; creator?: string }> } = {}) {
  const access = await getCommunityAdminAccess();
  if (access.response) {
    return <section role="alert" className="m-4 rounded-2xl border border-[var(--color-border)] bg-white p-6"><h1 className="font-serif text-2xl font-semibold">Brak dostępu do moderacji</h1><p className="mt-2 text-sm text-[var(--color-muted)]">Zaloguj się na zweryfikowane konto administratora.</p></section>;
  }
  const query = searchParams ? await searchParams : {};
  const status = ["pending", "approved", "rejected", "removed", "all"].includes(query.status ?? "") ? query.status as "pending" | "approved" | "rejected" | "removed" | "all" : undefined;
  const creator = typeof query.creator === "string" ? query.creator.replace(/^@/, "").slice(0, 24) : undefined;
  return (
    <>
      {supportsCommunityAvatars() && access.actor.backend === "supabase" ? (
        <div className="px-4 pt-4 sm:px-6">
          <Link href="/admin/community/avatars" className="inline-flex min-h-11 items-center rounded-md border border-[var(--color-border)] px-3 text-sm font-medium underline-offset-4 hover:underline">
            Moderuj zdjęcia profilowe
          </Link>
        </div>
      ) : null}
      <Suspense fallback={<section aria-busy="true" aria-label="Wczytywanie moderacji" className="space-y-4 p-6"><h1 className="font-serif text-3xl">Moderacja prac</h1><div className="h-24 animate-pulse rounded-xl bg-[var(--color-border)]" /><div className="h-72 animate-pulse rounded-xl bg-[var(--color-border)]" /></section>}><InitialModeration status={status} creator={creator} /></Suspense>
    </>
  );
}

async function InitialModeration({ status = "pending", creator = "" }: { status?: "pending" | "approved" | "rejected" | "removed" | "all"; creator?: string }) {
  const [productsResult, queueResult] = await Promise.allSettled([
    listCommunityModerationProductOptions(),
    listCommunityModerationQueue({ status, creator: creator || undefined, limit: 30 }),
  ]);
  // Product options have no client refetch. Retry the server read explicitly
  // instead of presenting a permanently empty filter as successful data.
  if (productsResult.status === "rejected") {
    const retryQuery = new URLSearchParams({ status, ...(creator ? { creator } : {}) });
    return <section role="alert" className="m-4 rounded-2xl border border-[var(--color-border)] bg-white p-6">
      <p>Nie udało się wczytać filtrów moderacji.</p>
      {/* A document navigation reruns this server read, including product options. */}
      <a href={`/admin/community?${retryQuery}`} className="inline-flex min-h-11 items-center font-semibold underline">Ponów wczytanie moderacji</a>
    </section>;
  }
  const products = productsResult.value;
  if (queueResult.status === "rejected") {
    return <CommunityModeration products={products} initialStatus={status} initialCreator={creator}
      initialError="Nie udało się wczytać kolejki. Spróbuj ponownie." />;
  }
  const queue = queueResult.value;
  // Start the selected private detail on the server, before hydration.
  const detail = queue.items[0]
    ? await getCommunityModerationArtwork(queue.items[0].id).catch(() => null)
    : null;
  return <CommunityModeration products={products} initialStatus={status} initialCreator={creator}
    initialQueue={queue} initialDetail={detail} />;
}
