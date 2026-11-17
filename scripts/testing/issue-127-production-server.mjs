// Explicit Playwright-managed local production server. Never deploys or uses hosted credentials.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import { loadIsolatedCommunityTarget, readCommunityCronSecret } from "./isolated-community-target.mjs";

const worktree = path.resolve(process.env.UX127_APP_WORKTREE ?? process.cwd());
const target = loadIsolatedCommunityTarget();
const certificate = process.env.UX127_TLS_CERT_PATH;
const key = process.env.UX127_TLS_KEY_PATH;
if (!certificate || !key || !path.isAbsolute(certificate) || !path.isAbsolute(key)) throw Error("Owned absolute TLS certificate/key paths are required.");
const tls = { cert: readFileSync(certificate), key: readFileSync(key) };
if (!process.env.UX127_TLS_CERT_SHA256 || new X509Certificate(tls.cert).fingerprint256 !== process.env.UX127_TLS_CERT_SHA256) throw Error("Owned loopback certificate fingerprint does not match the explicit test pin.");
const cronSecret = readCommunityCronSecret();
const appOrigin = "https://localhost:3443";
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:RESEND|R2_|AWS_|CLOUDFLARE_|PRODUCT_IMAGE_CLOUDFLARE_|VERCEL|SMTP|MAIL|SENDGRID|POSTMARK|SES_|TWILIO|CONTACT_|LAMILIA_CONTACT|SUPABASE|NEXT_PUBLIC_SUPABASE|DATABASE_URL)/i.test(name)));
const child = spawn(process.execPath, [path.join(worktree, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3128"], {
  cwd: worktree, windowsHide: true, stdio: ["ignore", "inherit", "inherit"],
  env: { ...childEnv, NODE_EXTRA_CA_CERTS: certificate, LAMILIA_BACKEND: "supabase", NEXT_PUBLIC_APP_URL: appOrigin,
    NEXT_TELEMETRY_DISABLED: "1", MEDIA_STORAGE_PROVIDER: "supabase", NEXT_PUBLIC_SUPABASE_URL: appOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: target.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: target.serviceRoleKey, CRON_SECRET: cronSecret,
    COLORING_CLUB_ADMIN_EMAIL: "moderation@example.test",
    COLORING_CLUB_PUBLIC_ENABLED: process.env.COLORING_CLUB_PUBLIC_ENABLED ?? "true",
    COLORING_CLUB_UPLOADS_ENABLED: process.env.COLORING_CLUB_UPLOADS_ENABLED ?? "true",
  },
});
const sockets = new Set();
const proxy = https.createServer(tls, (request, response) => {
  const pathname = new URL(request.url ?? "/", appOrigin).pathname;
  const isLocalSupabase = /^\/(auth|rest|storage)\/v1(?:\/|$)/.test(pathname);
  const upstream = http.request({ host: "127.0.0.1", port: isLocalSupabase ? 55421 : 3128, path: request.url, method: request.method,
    headers: { ...request.headers, host: "localhost:3443", "x-forwarded-host": "localhost:3443", "x-forwarded-proto": "https" } }, (result) => {
    response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end("Local production server is starting."); });
  request.pipe(upstream);
  response.on("close", () => upstream.destroy());
});
proxy.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
proxy.listen(3443, "127.0.0.1", () => console.log(`Owned HTTPS test proxy ${appOrigin} -> loopback production Next port 3128; worktree ${worktree}`));
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  proxy.close(); for (const socket of sockets) socket.destroy();
  child.kill("SIGTERM");
  setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); process.exit(0); }, 4000).unref();
}
process.on("SIGTERM", stop); process.on("SIGINT", stop);
proxy.on("error", () => { console.error("Owned HTTPS proxy could not listen on its dedicated loopback port."); stop(); process.exitCode = 1; });
child.on("error", () => { console.error("Owned production Next process could not start."); stop(); process.exitCode = 1; });
child.on("exit", (code) => { if (!closing) { proxy.close(); for (const socket of sockets) socket.destroy(); process.exitCode = code ?? 1; } });
