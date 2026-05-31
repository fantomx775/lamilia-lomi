import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/i18n/routing";

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
          Production sends contact messages through Resend. Without an API key,
          the route returns a safe local stub response.
        </p>
      </div>
      <Card>
        <CardHeader>
          <h2 className="font-serif text-2xl font-semibold">Message</h2>
        </CardHeader>
        <CardContent>
          <form action="/api/contact" method="post" className="grid gap-4">
            <input type="hidden" name="locale" value={locale} />
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="Your name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="you@example.com" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="message">Message</Label>
              <Textarea id="message" name="message" placeholder="How can we help?" />
            </div>
            <Button type="submit">
              <Send className="size-4" aria-hidden />
              Send
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
