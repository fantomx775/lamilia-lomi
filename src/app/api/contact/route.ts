import { NextResponse } from "next/server";

import { buildContactEmail, validateContactInput } from "@/lib/contact";
import { getResendClient } from "@/lib/email";

export async function POST(request: Request) {
  const formData = await request.formData();
  const parsed = validateContactInput({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    message: String(formData.get("message") ?? ""),
    locale: String(formData.get("locale") ?? "en") as "en" | "pl",
  });

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid contact form" }, { status: 400 });
  }

  const email = buildContactEmail(parsed.data);
  const resend = getResendClient();

  if (!resend) {
    return NextResponse.json({
      ok: true,
      mode: "stub",
      email,
    });
  }

  await resend.emails.send({
    from: "LamiliaLomi <hello@lamilialomi.com>",
    to: "owner@lamilialomi.com",
    replyTo: parsed.data.email,
    subject: email.subject,
    text: email.text,
  });

  return NextResponse.json({ ok: true, mode: "resend" });
}
