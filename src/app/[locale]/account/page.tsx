import { logoutAction, verifyDemoEmailAction } from "@/app/actions";
import { DashboardShell, type DashboardNavItem } from "@/components/dashboard-shell";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CommunityAccountPanel } from "@/components/community/community-account-panel";
import { AccountDeletionPanel } from "@/components/account/account-deletion-panel";
import { NavigationLink } from "@/components/navigation-link";
import type { Locale } from "@/i18n/routing";
import { getCommunityFlags } from "@/lib/community-flags";
import { getMyCommunityProfile } from "@/lib/community/repository";
import { sanitizeReturnTo } from "@/lib/return-to";
import { getAccountSessionForRequest } from "@/lib/session.server";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export const metadata = {
  title: "Account | LamiliaLomi",
  robots: { index: false, follow: false },
};

export default async function AccountPage({ params }: Props) {
  const { locale } = await params;
  const session = await getAccountSessionForRequest();
  const communityFlags = getCommunityFlags();
  const communityProfile = session?.emailVerified ? await getMyCommunityProfile() : null;
  const nav: DashboardNavItem[] = [
    { href: `/${locale}/account`, label: "Account", icon: "account" },
    { href: `/${locale}/library`, label: "My Library", icon: "library" },
    ...(communityFlags.uploadsEnabled || communityProfile
      ? [{ href: `/${locale}/library/creations`, label: "My Creations", icon: "library" as const }]
      : []),
    { href: `/${locale}/products`, label: "Catalog", icon: "catalog" },
  ];

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Card>
          <CardHeader>
            <h1 className="font-serif text-3xl font-semibold">
              Account
            </h1>
          </CardHeader>
          <CardContent>
            <p className="text-[var(--color-muted)]">
              Log in to view account details.
            </p>
            <NavigationLink
              className="mt-4 inline-flex rounded-sm text-sm font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
              href={`/${locale}/login?returnTo=${encodeURIComponent(sanitizeReturnTo(`/${locale}/account`, locale))}`}
              pendingLabel="Opening login"
            >
              Log in to join Coloring Club
            </NavigationLink>
            <NavigationLink
              className="mt-4 inline-flex rounded-sm text-sm font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
              href={`/${locale}/community-guidelines`}
              pendingLabel="Opening community guidelines"
            >
              Read the community guidelines
            </NavigationLink>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <DashboardShell
      nav={nav}
      title="LamiliaLomi"
      subtitle="User dashboard"
    >
      <Card>
        <CardHeader>
          <p className="text-sm font-medium text-[var(--color-terracotta)]">
            User dashboard
          </p>
          <h1 className="mt-2 font-serif text-4xl font-semibold">
            Account
          </h1>
          <p className="text-sm text-[var(--color-muted)]">{session.email}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
              <dt>Role</dt>
              <dd>{session.role}</dd>
            </div>
            <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
              <dt>Email</dt>
              <dd>{session.emailVerified ? "verified" : "unverified"}</dd>
            </div>
            <div className="flex justify-between border-b border-[var(--color-border)] pb-2">
              <dt>Marketing consent</dt>
              <dd>{session.marketingConsent ? "yes" : "no"}</dd>
            </div>
          </dl>
          {!session.emailVerified && session.isDemo ? (
            <form action={verifyDemoEmailAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="returnTo" value={`/${locale}/account`} />
              <SubmitButton pendingLabel="Working…">Mark demo email as verified</SubmitButton>
            </form>
          ) : null}
          {!session.emailVerified && !session.isDemo ? (
            <NavigationLink
              className="inline-flex rounded-sm text-sm font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
              href={`/${locale}/login?error=email_unverified&returnTo=${encodeURIComponent(sanitizeReturnTo(`/${locale}/account`, locale))}`}
              pendingLabel="Opening email verification"
            >
              Open email verification options
            </NavigationLink>
          ) : null}
          <CommunityAccountPanel
            profile={communityProfile}
            enabled={communityFlags.publicEnabled || communityFlags.uploadsEnabled}
            publicEnabled={communityFlags.publicEnabled}
            emailVerified={session.emailVerified}
            guidelinesHref={`/${locale}/community-guidelines`}
            creatorProfileBaseHref={`/${locale}/club/creators`}
            contactHref={`/${locale}/contact`}
          />
          <AccountDeletionPanel locale={locale} />
          <form action={logoutAction}>
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="outline">
              Log out
            </Button>
          </form>
        </CardContent>
      </Card>
    </DashboardShell>
  );
}
