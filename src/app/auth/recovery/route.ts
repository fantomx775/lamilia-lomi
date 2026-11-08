import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { getBackendMode, getCanonicalAppUrl } from "@/lib/config";
import { createRecoveryClient } from "@/lib/supabase/recovery";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

// Keep the link credential out of HTTP URLs and away from third-party scripts.
// Require a user click before redeeming it so a mail scanner's GET is harmless.
const script = `
  const token = new URLSearchParams(location.hash.slice(1)).get("token_hash");
  history.replaceState(null, "", location.pathname);
  const form = document.querySelector("form");
  const button = form.querySelector("button");
  if (token) {
    form.elements.token_hash.value = token;
    button.disabled = false;
    form.addEventListener("submit", () => {
      button.disabled = true;
      button.textContent = "Checking reset link…";
    });
  } else {
    document.getElementById("instructions").textContent = "Open the full link from your email, or request a new one.";
  }
`;
const styles = `body{background:#f7f4ef;color:#242720;font:1rem system-ui;margin:0;padding:2rem 1rem}
main{max-width:28rem;margin:10vh auto 0;background:white;border:1px solid #ddd4c9;border-radius:12px;padding:1.5rem}
h1{font-family:Georgia,serif}button{font:inherit;color:white;background:#2c4438;padding:.7rem 1rem;border:0;border-radius:6px}
button:disabled{opacity:.65}a{color:#2c4438}`;
const digest = (value: string) => createHash("sha256").update(value).digest("base64");

export function GET() {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirm password reset | Lamilia Lomi</title><style>${styles}</style></head>
<body><main><h1>Confirm password reset</h1>
<p id="instructions">Continue to choose a new password for your account.</p>
<form method="post" action="/auth/recovery">
<input name="token_hash" type="hidden">
<button type="submit" disabled>Continue to reset password</button>
</form>
<noscript><p>Enable JavaScript and reopen the link from your email.</p></noscript>
<p><a href="/en/reset-password">Request a new link</a></p>
</main><script>${script}</script></body></html>`, {
    headers: {
      ...headers,
      "Referrer-Policy": "same-origin",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${digest(script)}'; style-src 'sha256-${digest(styles)}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}

export async function POST(request: Request) {
  const origin = getCanonicalAppUrl();
  if (request.headers.get("origin") !== origin.origin) {
    return new Response(null, { status: 403, headers });
  }

  let verified = false;
  try {
    if (getBackendMode() === "supabase" &&
      request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
      const tokenHash = (await request.formData()).get("token_hash");
      if (typeof tokenHash === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(tokenHash)) {
        const supabase = await createRecoveryClient();
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        verified = !error && Boolean(data.session);
      }
    }
  } catch {
    console.error("[password-recovery] Link verification failed");
  }
  const target = new URL("/en/reset-password", origin);
  target.searchParams.set("status", verified ? "choose-password" : "invalid-link");
  return NextResponse.redirect(target, { status: 303, headers });
}
