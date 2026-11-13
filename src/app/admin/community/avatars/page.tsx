import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCommunityAdminAccess } from "@/lib/community/admin-http";
import { listCommunityAvatarModeration, supportsCommunityAvatars } from "@/lib/community/avatar-repository";
import { AvatarModerationActions } from "./avatar-moderation-actions";

export const dynamic = "force-dynamic";

export default async function AdminAvatarModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; creator?: string }>;
}) {
  const access = await getCommunityAdminAccess();
  if (access.response || !supportsCommunityAvatars()) notFound();

  const query = await searchParams;
  const status = query.status === "approved" ? "approved" : "pending";
  const page = typeof query.page === "string" && /^\d{1,5}$/.test(query.page) ? Number(query.page) : 0;
  const username = typeof query.creator === "string" && /^[a-z0-9_]{3,24}$/.test(query.creator) ? query.creator : undefined;
  const { items, hasNext } = await listCommunityAvatarModeration(page, status, username);
  const href = (target: "pending" | "approved", index = 0) =>
    `?status=${target}&page=${index}${username ? `&creator=${encodeURIComponent(username)}` : ""}`;

  return (
    <section className="mx-auto grid max-w-5xl gap-5 p-4 sm:p-6">
      <Link href="/admin/community" className="w-fit underline">Moderacja prac</Link>
      <h1 className="font-serif text-3xl font-semibold">Zdjęcia profilowe Coloring Club</h1>
      <p className="text-sm text-[var(--color-muted)]">Odrzuć zdjęcia identyfikujące dzieci oraz zdjęcia zawierające dane osobowe lub informacje o lokalizacji.</p>
      <nav aria-label="Stan zdjęcia" className="flex gap-4">
        <Link className="underline" aria-current={status === "pending" ? "page" : undefined} href={href("pending")}>Oczekujące</Link>
        <Link className="underline" aria-current={status === "approved" ? "page" : undefined} href={href("approved")}>Zatwierdzone</Link>
      </nav>
      <form className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="status" value={status} />
        <label className="grid gap-1 text-sm">Nazwa twórcy
          <input name="creator" defaultValue={username} maxLength={24} pattern="[a-z0-9_]{3,24}"
            className="min-h-11 max-w-full rounded-md border border-[var(--color-border)] px-3 text-base" />
        </label>
        <button className="min-h-11 rounded-md border border-[var(--color-border)] px-3">Szukaj</button>
      </form>
      {items.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-white p-4">
              <Image src={`/api/admin/community/avatars/${item.id}`} alt={`Zdjęcie profilowe @${item.username}`}
                width={192} height={192} unoptimized className="size-48 max-w-full rounded-lg object-cover" />
              <h2 className="break-all font-medium">@{item.username}</h2>
              <time className="text-sm text-[var(--color-muted)]" dateTime={item.createdAt}>
                {new Intl.DateTimeFormat("pl", { dateStyle: "medium" }).format(new Date(item.createdAt))}
              </time>
              <AvatarModerationActions id={item.id} status={status} />
            </li>
          ))}
        </ul>
      ) : <p>Brak zdjęć w tej kolejce.</p>}
      <nav aria-label="Strony zdjęć" className="flex gap-4">
        {page > 0 ? <Link className="underline" href={href(status, page - 1)}>Poprzednia</Link> : null}
        {hasNext ? <Link className="underline" href={href(status, page + 1)}>Następna</Link> : null}
      </nav>
    </section>
  );
}
