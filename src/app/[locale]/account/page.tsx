import { logoutAction, verifyDemoEmailAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { getDemoSession } from "@/lib/session.server";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export default async function AccountPage({ params }: Props) {
  const { locale } = await params;
  const session = await getDemoSession();

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Card>
          <CardHeader>
            <h1 className="font-serif text-3xl font-semibold">Account</h1>
          </CardHeader>
          <CardContent>
            <p className="text-[var(--color-muted)]">Log in to view account details.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Card>
        <CardHeader>
          <h1 className="font-serif text-3xl font-semibold">Account</h1>
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
          {!session.emailVerified ? (
            <form action={verifyDemoEmailAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="redirectTo" value={`/${locale}/account`} />
              <Button type="submit">Mark demo email as verified</Button>
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
    </div>
  );
}
