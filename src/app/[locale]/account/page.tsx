import { logoutAction, verifyDemoEmailAction } from "@/app/actions";
import { DashboardShell, type DashboardNavItem } from "@/components/dashboard-shell";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { getAccountSessionForRequest } from "@/lib/session.server";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export default async function AccountPage({ params }: Props) {
  const { locale } = await params;
  const session = await getAccountSessionForRequest();
  const nav: DashboardNavItem[] = [
    { href: `/${locale}/account`, label: "Account", icon: "account" },
    { href: `/${locale}/library`, label: "My Library", icon: "library" },
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
