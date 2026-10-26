import { getCommunityAdminAccess } from "@/lib/community/admin-http";
import { listCommunityModerationProductOptions } from "@/lib/community/repository";
import CommunityModeration from "./community-moderation";

export const dynamic = "force-dynamic";

export default async function AdminCommunityPage({ searchParams }: { searchParams?: Promise<{ status?: string; creator?: string }> } = {}) {
  const access = await getCommunityAdminAccess();
  if (access.response) {
    return <section role="alert" className="m-4 rounded-2xl border border-[var(--color-border)] bg-white p-6"><h1 className="font-serif text-2xl font-semibold">Brak dostępu do moderacji</h1><p className="mt-2 text-sm text-[var(--color-muted)]">Zaloguj się na zweryfikowane konto administratora.</p></section>;
  }
  const productOptions = await listCommunityModerationProductOptions();
  const query = searchParams ? await searchParams : {};
  const status = ["pending", "approved", "rejected", "removed", "all"].includes(query.status ?? "") ? query.status as "pending" | "approved" | "rejected" | "removed" | "all" : undefined;
  const creator = typeof query.creator === "string" ? query.creator.replace(/^@/, "").slice(0, 24) : undefined;
  return <CommunityModeration products={productOptions} initialStatus={status} initialCreator={creator} />;
}
