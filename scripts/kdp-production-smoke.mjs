// Explicitly authorized release smoke. Never logs credentials, codes or signed URLs.
// Creates only temporary accounts; the product's permanent shared code is retained.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';

const origin = process.env.KDP_SMOKE_ORIGIN;
const api = 'https://ebyhoawczbexwtioywuk.supabase.co';
assert(origin && new URL(origin).origin === 'https://www.lamilialomi.com', 'Exact canonical Production target required');
assert(process.env.KDP_PRODUCTION_SMOKE === 'authorized', 'Explicit Production smoke authorization required');
const secret = process.env.LAMILIA_LOMI_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert(secret && publishable, 'Supabase credentials must be present in environment');
const admin = createClient(api, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('apikey', secret);
    if (!secret.startsWith('eyJ')) headers.delete('authorization');
    return fetch(url, { ...init, headers });
  } },
});
const report = { startedAt: new Date().toISOString(), origin, checks: [], cleanup: 'NOT RUN' };
const accounts = [];
let browser;
const check = (name) => { report.checks.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); };
const ok = (result, label) => { assert(!result.error, `${label} failed`); return result.data; };
const password = `Kdp-${randomUUID()}!aA7`;
async function account(label, role = 'user') {
  const email = `kdp-release-${label}-${randomUUID()}@example.test`;
  const { user } = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create smoke account');
  assert(user); accounts.push(user.id);
  if (role === 'admin') ok(await admin.from('profiles').update({ role: 'admin' }).eq('id', user.id), 'Set smoke administrator');
  const client = createClient(api, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { session } = ok(await client.auth.signInWithPassword({ email, password }), 'Sign in smoke account');
  assert(session);
  const context = await browser.newContext({ baseURL: origin });
  // Use Supabase SSR's documented cookie encoding; each cookie stays in memory.
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  const name = 'sb-ebyhoawczbexwtioywuk-auth-token';
  const chunks = encoded.match(/.{1,3180}/g);
  await context.addCookies(chunks.map((value, index) => ({
    name: chunks.length === 1 ? name : `${name}.${index}`, value,
    url: origin, secure: true, sameSite: 'Lax',
  })));
  return { context, client, user };
}
try {
  browser = await chromium.launch();
  const products = ok(await admin.from('products').select('id,slug').eq('status', 'published').order('created_at'), 'Read products');
  const assets = ok(await admin.from('product_assets').select('id,product_id,path,bucket').eq('kind', 'premium_download').eq('is_active', true), 'Read premium assets');
  const activeShared = ok(await admin.from('premium_codes').select('product_id').eq('code_type', 'shared').eq('active', true).is('retired_at', null), 'Read current shared codes');
  const activeProductIds = new Set(activeShared.map((code) => code.product_id));
  const asset = assets.find((a) => activeProductIds.has(a.product_id) && products.some((p) => p.id === a.product_id));
  assert(asset, 'A published product with an active shared code and premium asset is required');
  const product = products.find((p) => p.id === asset.product_id);
  report.productId = product.id;
  const manager = await account('admin', 'admin');
  const a = await account('reader-a');
  const b = await account('reader-b');
  const guest = await browser.newContext({ baseURL: origin });
  const denied = await guest.request.get(`/api/downloads/${asset.id}`, { headers: { accept: 'application/json' } });
  assert.equal(denied.status(), 401); check('Guest premium download denied');
  const before = await b.context.request.get(`/api/downloads/${asset.id}`, { headers: { accept: 'application/json' } });
  assert.equal(before.status(), 403); check('Verified locked reader denied');
  const management = `/api/admin/products/${product.id}/shared-code`;
  const current = await manager.context.request.get(management);
  assert.equal(current.status(), 200);
  const { code } = await current.json();
  assert(code?.code && code.codeType === 'shared' && code.active); check('Production admin reads current active shared code');
  for (const [format, mime] of [['svg', 'image/svg+xml'], ['pdf', 'application/pdf']]) {
    const output = await manager.context.request.get(`${management}?format=${format}`);
    assert.equal(output.status(), 200); assert(output.headers()['content-type'].startsWith(mime));
    const bytes = await output.body(); assert(bytes.length > 1000);
    if (format === 'pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    check(`Production ${format.toUpperCase()} generator returns vector print asset`);
  }
  const hidden = await guest.request.get(management); assert.equal(hidden.status(), 401);
  check('Guest cannot read shared code administration');
  const scan = `/en/unlock/${product.id}#${new URLSearchParams({ productId: product.id, code: code.code })}`;
  const page = await a.context.newPage();
  let leaked = false;
  let browserErrors = 0;
  page.on('pageerror', () => { browserErrors += 1; });
  page.on('console', (message) => { if (message.type() === 'error') browserErrors += 1; });
  page.on('request', (r) => { if (r.url().includes(code.code)) leaked = true; });
  await page.goto(scan);
  await page.getByTestId('unlock-success-state').waitFor();
  assert(!page.url().includes(code.code)); assert(!leaked); check('QR automatically unlocks and keeps code out of network URLs');
  const attempts = await Promise.all(Array.from({ length: 8 }, () => b.client.rpc('redeem_premium_code', { requested_product_id: product.id, requested_code: code.code })));
  for (const result of attempts) assert(['success', 'already_unlocked'].includes(ok(result, 'Concurrent redemption').status));
  assert.equal(attempts.filter((r) => r.data.status === 'success').length, 1);
  check('Second account concurrent manual activations grant exactly one entitlement');
  await page.goto(scan); await page.getByTestId('unlock-success-state').waitFor(); check('Repeat Production QR scan is idempotent');
  for (const reader of [a, b]) {
    const download = await reader.context.request.get(`/api/downloads/${asset.id}`, { headers: { accept: 'application/json' } });
    assert.equal(download.status(), 200); assert((await download.body()).length > 0);
  }
  check('Both separate accounts download private premium content');
  const invalid = ok(await b.client.rpc('redeem_premium_code', { requested_product_id: product.id, requested_code: `INVALID-${randomUUID()}` }), 'Invalid code');
  assert.equal(invalid.status, 'invalid_code'); check('Invalid Production code rejected');
  const entitlements = ok(await admin.from('user_product_unlocks').select('user_id').eq('product_id', product.id).in('user_id', [a.user.id, b.user.id]), 'Read grants');
  assert.equal(entitlements.length, 2); check('Production has exactly two independent reader grants');
  const row = ok(await admin.from('premium_codes').select('redeemed_at,redeemed_by,code_type').eq('id', code.id).single(), 'Shared state');
  assert.equal(row.code_type, 'shared'); assert.equal(row.redeemed_at, null); assert.equal(row.redeemed_by, null);
  check('Shared code remains unconsumed');
  assert.equal(browserErrors, 0, 'Production browser must have no new console or script errors');
  check('Production premium browser flow has no console or script errors');
  await guest.close();
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  // Error messages from libraries may contain sensitive request information.
  report.failure = error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Smoke operation failed; inspect protected runtime logs';
  process.exitCode = 1;
} finally {
  await browser?.close();
  let cleaned = true;
  for (const id of accounts.reverse()) { const result = await admin.auth.admin.deleteUser(id); if (result.error) cleaned = false; }
  report.cleanup = cleaned ? 'PASS' : 'FAIL';
  if (!cleaned) { report.status = 'FAIL'; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  const destination = process.env.KDP_SMOKE_REPORT;
  if (destination) fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}
