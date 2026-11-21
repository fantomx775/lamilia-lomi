import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { ContactForm } from "@/components/contact-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";

export const metadata: Metadata = { title: "Contact", description: "Ask about a LamiliaLomi book or get help with your bonus files.", alternates: { canonical: "/en/contact" } };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export default async function ContactPage({ params }: Props) {
  const { locale } = await params;

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-[0.8fr_1.2fr]">
      <div>
        <p className="text-sm font-medium text-[var(--color-terracotta)]">Contact</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold">Send a calm note</h1>
        <p className="mt-4 text-[var(--color-muted)]">
          Have a question about a book or need help with your bonus files?
          Leave a message and an email address where we can reply.
        </p>
      </div>
      <Card>
        <CardHeader>
          <h2 className="font-serif text-2xl font-semibold">Message</h2>
        </CardHeader>
        <CardContent>
          <ContactForm locale={locale} requestId={randomUUID()} />
        </CardContent>
      </Card>
    </div>
  );
}
