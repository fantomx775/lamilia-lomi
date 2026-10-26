import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { COMMUNITY_RULES_VERSION } from "@/lib/community/rules";

export const metadata = {
  title: "Community guidelines | LamiliaLomi",
  description: "Read the current Coloring Club community guidelines before joining.",
};

export default async function CommunityGuidelinesPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Card>
        <CardHeader>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-[var(--color-terracotta)]">
            Coloring Club · Version {COMMUNITY_RULES_VERSION}
          </p>
          <h1 className="font-serif text-3xl font-semibold text-[var(--color-ink)] sm:text-4xl">
            Community guidelines
          </h1>
          <p className="text-sm leading-6 text-[var(--color-muted)]">
            These guidelines explain how member artwork is reviewed and shared.
          </p>
        </CardHeader>
        <CardContent className="space-y-7 text-sm leading-7 text-[var(--color-muted)]">
          <section aria-labelledby="guidelines-membership">
            <h2 id="guidelines-membership" className="font-semibold text-[var(--color-ink)]">Who can join</h2>
            <p className="mt-2">Coloring Club accounts are operated by adults. Joining requires a verified account, an adult self-attestation, and acceptance of this current version of the community guidelines. Community participation is separate from marketing consent.</p>
          </section>
          <section aria-labelledby="guidelines-content">
            <h2 id="guidelines-content" className="font-semibold text-[var(--color-ink)]">Share your own work safely</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>Share artwork you made or have permission to share, and respect the rights of artists and publishers.</li>
              <li>Do not include identifiable photos of children, contact details, addresses, location or GPS information, or other private information.</li>
              <li>Do not submit abusive, hateful, threatening, unlawful, or otherwise harmful content.</li>
              <li>Use a public username that does not impersonate another person, staff member, or organization.</li>
            </ul>
          </section>
          <section aria-labelledby="guidelines-review">
            <h2 id="guidelines-review" className="font-semibold text-[var(--color-ink)]">Review and visibility</h2>
            <p className="mt-2">New work stays private while it is pending review. Only approved work appears on public creator profiles. If you edit a pending, approved, or rejected description, the updated version returns to review. Editing removed work does not restore it; an administrator must restore it explicitly. You can delete your own work, which immediately removes it from public views.</p>
            <p className="mt-2">When work is rejected or removed, the decision reason is visible to you and the moderation team. It is not shown publicly.</p>
          </section>
          <section aria-labelledby="guidelines-help">
            <h2 id="guidelines-help" className="font-semibold text-[var(--color-ink)]">Questions or safety concerns</h2>
            <p className="mt-2">For a concern about community content or account participation, use the site’s <Link className="font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" href={`/${locale}/contact`}>contact page</Link>. Please do not include sensitive personal information in a public username or artwork description.</p>
          </section>
          <p className="border-t border-[var(--color-border)] pt-5 text-xs">Current guidelines version: {COMMUNITY_RULES_VERSION}. This page describes the current product rules and is not a claim of professional legal review.</p>
        </CardContent>
      </Card>
    </div>
  );
}
