import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildContactEmail, validateContactInput } from "@/lib/contact";
import { getResendClient } from "@/lib/email";
import { getBackendMode } from "@/lib/config";
import { normalizeLocale } from "@/lib/locale";
import { isSameOriginCommunityRequest } from "@/lib/community/http";

export const runtime = "nodejs";
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOriginCommunityRequest(request)) return json({ ok: false, error: "Refresh the page and try again." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return json({ ok: false, error: "Invalid contact form" }, 400);
  let body = "";
  try {
    const reader = request.body?.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    if (reader) for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 64 * 1024) { await reader.cancel(); return json({ ok: false, error: "Your message is too long." }, 413); }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
  } catch { return json({ ok: false, error: "Invalid contact form" }, 400); }
  const form = new URLSearchParams(body);
  const parsed = validateContactInput({ name: form.get("name") ?? "", email: form.get("email") ?? "", message: form.get("message") ?? "", locale: normalizeLocale(form.get("locale") ?? "en") });
  if (!parsed.success) {
    const fields = Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message]));
    return json({ ok: false, error: "Check the highlighted fields.", fields }, 400);
  }
  const key = form.get("requestId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) return json({ ok: false, error: "Refresh the page and try again." }, 400);
  // Bind retries to this exact payload. Provider idempotency protects uncertain
  // delivery (including client timeout) without sending duplicate messages.
  const deliveryKey = createHash("sha256").update(key).update(JSON.stringify(parsed.data)).digest("hex");
  const email = buildContactEmail(parsed.data);
  try {
    const target = new URL(request.url);
    if (process.env.LAMILIA_CONTACT_TEST_SINK === "1" && getBackendMode() === "local" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.headers.get("origin")!).hostname)) {
      const directory = path.join(process.cwd(), ".data", "contact-test-outbox");
      await mkdir(directory, { recursive: true });
      try { await writeFile(path.join(directory, `${deliveryKey}.json`), JSON.stringify({ ...email, replyTo: parsed.data.email }), { flag: "wx" }); }
      catch (cause) { if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "EEXIST")) throw cause; }
      return json({ ok: true, mode: "local-test-sink" });
    }
    const resend = getResendClient();
    if (!resend) return json({ ok: false, error: "Messages cannot be sent right now. Your draft is still here; please try again later." }, 503);
    const result = await resend.emails.send({ from: "LamiliaLomi <hello@lamilialomi.com>", to: "owner@lamilialomi.com", replyTo: parsed.data.email, subject: email.subject, text: email.text }, { idempotencyKey: `contact-${deliveryKey}` });
    if (result.error || !result.data?.id) return json({ ok: false, error: "Your message was not accepted. Your draft is still here; please try again." }, 502);
    return json({ ok: true, mode: "resend" });
  } catch { return json({ ok: false, error: "We could not confirm delivery. Your draft is still here. Retry the same message safely." }, 502); }
}
