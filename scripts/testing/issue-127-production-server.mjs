// Explicit Playwright-managed local production server. Never deploys or uses hosted credentials.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { timingSafeEqual, X509Certificate } from "node:crypto";
import { loadIsolatedCommunityTarget, readCommunityCronSecret } from "./isolated-community-target.mjs";
import { rewriteIsolatedTusLocation } from "./issue-127-tus-location.mjs";

const worktree = path.resolve(process.env.UX127_APP_WORKTREE ?? process.cwd());
const target = loadIsolatedCommunityTarget();
const certificate = process.env.UX127_TLS_CERT_PATH;
const key = process.env.UX127_TLS_KEY_PATH;
if (!certificate || !key || !path.isAbsolute(certificate) || !path.isAbsolute(key)) throw Error("Owned absolute TLS certificate/key paths are required.");
const tls = { cert: readFileSync(certificate), key: readFileSync(key) };
if (!process.env.UX127_TLS_CERT_SHA256 || new X509Certificate(tls.cert).fingerprint256 !== process.env.UX127_TLS_CERT_SHA256) throw Error("Owned loopback certificate fingerprint does not match the explicit test pin.");
const cronSecret = readCommunityCronSecret();
const mediaGateSecretPath = process.env.UX127_MEDIA_GATE_SECRET_PATH;
const mediaGateSecret = mediaGateSecretPath && path.isAbsolute(mediaGateSecretPath)
  ? readFileSync(mediaGateSecretPath, "utf8").trim()
  : "";
if (mediaGateSecretPath && (mediaGateSecret.length < 32 || /\s/.test(mediaGateSecret))) {
  throw Error("The private local media test gate secret is invalid.");
}
const mediaGateSecretBytes = Buffer.from(mediaGateSecret);
let activeMediaGate = null;
function gateJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
function authorizedMediaGateRequest(request) {
  const authorization = request.headers.authorization;
  if (!mediaGateSecretBytes.length || typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(authorization.slice(7));
  return candidate.length === mediaGateSecretBytes.length && timingSafeEqual(candidate, mediaGateSecretBytes);
}
async function readMediaGateBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw Error("oversized test control request");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function handleMediaGateControl(request, response) {
  if (!mediaGateSecretBytes.length) {
    gateJson(response, 404, { error: "not_found" });
    return;
  }
  if (!authorizedMediaGateRequest(request)) {
    gateJson(response, 403, { error: "forbidden" });
    return;
  }
  if (request.method === "GET") {
    gateJson(response, 200, activeMediaGate ? {
      armed: true, path: activeMediaGate.path, mode: activeMediaGate.mode,
      arrivals: activeMediaGate.arrivals, clientClosed: activeMediaGate.clientClosed,
      released: activeMediaGate.released, aborted: activeMediaGate.aborted, http503: activeMediaGate.http503, requestArrivals: activeMediaGate.requestArrivals,
    } : { armed: false, arrivals: 0, clientClosed: 0, released: 0, aborted: 0, http503: 0 });
    return;
  }
  if (request.method !== "POST") {
    gateJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  let body;
  try { body = await readMediaGateBody(request); }
  catch {
    gateJson(response, 400, { error: "invalid_request" });
    return;
  }
  const mediaPath = body?.path;
  if (typeof mediaPath !== "string" || !/^\/api\/media\/[a-f0-9-]{36}$/i.test(mediaPath)) {
    gateJson(response, 400, { error: "invalid_request" });
    return;
  }
  if (body.action === "arm" && ["hold", "abort", "http-503"].includes(body.mode)) {
    if (activeMediaGate) {
      gateJson(response, 409, { error: "gate_already_armed" });
      return;
    }
    let release;
    const releasedPromise = new Promise((resolve) => { release = resolve; });
    activeMediaGate = { path: mediaPath, mode: body.mode, arrivals: 0, clientClosed: 0, released: 0, aborted: 0, http503: 0, requestArrivals: [], release, releasedPromise };
    gateJson(response, 200, { armed: true });
    return;
  }
  if (body.action === "release" && activeMediaGate?.path === mediaPath) {
    activeMediaGate.release();
    gateJson(response, 200, { released: true });
    return;
  }
  if (body.action === "disarm" && activeMediaGate?.path === mediaPath) {
    activeMediaGate.release();
    activeMediaGate = null;
    gateJson(response, 200, { armed: false });
    return;
  }
  gateJson(response, 409, { error: "gate_state_mismatch" });
}
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
const proxy = https.createServer(tls, async (request, response) => {
  const pathname = new URL(request.url ?? "/", appOrigin).pathname;
  if (pathname === "/_ux127/test/media-gate") {
    await handleMediaGateControl(request, response);
    return;
  }
  const isLocalSupabase = /^\/(auth|rest|storage)\/v1(?:\/|$)/.test(pathname);
  const gate = activeMediaGate;
  if (gate && request.method === "GET" && gate.path === pathname) {
    gate.arrivals += 1;
    const rawRange = request.headers.range;
    const arrival = { sequence: gate.arrivals, method: request.method,
      range: typeof rawRange === "string" && /^bytes=\d{1,16}-\d{0,16}$/.test(rawRange) ? rawRange : rawRange === undefined ? null : "invalid-range",
      arrivedAtEpochMs: Date.now(), outcome: "pending", responseStatus: null, responseAtEpochMs: null };
    gate.requestArrivals.push(arrival);
    if (gate.requestArrivals.length > 64) gate.requestArrivals.shift();
    if (gate.mode === "http-503") {
      arrival.outcome = "http-503";
      arrival.responseStatus = 503;
      arrival.responseAtEpochMs = Date.now();
      gate.http503 += 1;
      response.writeHead(503, { "content-type": "video/mp4", "content-length": "0", "cache-control": "no-store" });
      response.end();
      return;
    }
    if (gate.mode === "abort") {
      gate.aborted += 1;
      response.destroy();
      return;
    }
    let clientClosed = false;
    const closed = new Promise((resolve) => {
      response.once("close", () => {
        if (!response.writableEnded) {
          clientClosed = true;
          gate.clientClosed += 1;
          resolve("closed");
        }
      });
    });
    const outcome = await Promise.race([gate.releasedPromise.then(() => "released"), closed]);
    if (outcome === "closed" || clientClosed || response.destroyed) return;
    gate.released += 1;
  }
  const upstream = http.request({ host: "127.0.0.1", port: isLocalSupabase ? 55421 : 3128, path: request.url, method: request.method,
    headers: { ...request.headers, host: "localhost:3443", "x-forwarded-host": "localhost:3443", "x-forwarded-proto": "https" } }, (result) => {
    const headers = { ...result.headers };
    if (isLocalSupabase && /^\/storage\/v1\/upload\/resumable(?:\/|$)/.test(pathname) && headers.location) {
      try { headers.location = rewriteIsolatedTusLocation(request.url ?? "/", headers.location); }
      catch {
        result.resume(); response.writeHead(502); response.end("Unexpected isolated Storage upload location."); return;
      }
    }
    response.writeHead(result.statusCode ?? 502, headers); result.pipe(response);
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
