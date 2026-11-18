import { NextCancellationObserver } from './helpers/next-navigation-cancellations';
import { test, expect, type Page, type Locator, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
type Probe = { token: string; destination: string; start: number | null; feedback: number | null; fallback: number | null; useful: number | null; completed: number | null };
declare global { interface Window { __uxProbe?: Probe } }
const samples: Array<Record<string, unknown>> = [];
async function settleVisibleImages(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.locator('img').evaluateAll(images => images
        .filter((img): img is HTMLImageElement => img instanceof HTMLImageElement)
        .filter(img => { const b = img.getBoundingClientRect(), s = getComputedStyle(img); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none'; })
        .every(img => img.complete && img.naturalWidth > 0)), {
        timeout: 15000, message: 'Visible source/destination image bytes decode before sample reset'
    }).toBe(true);
    await page.locator('img').evaluateAll(async images => {
        await Promise.all(images.filter((img): img is HTMLImageElement => img instanceof HTMLImageElement)
            .filter(img => { const b = img.getBoundingClientRect(), s = getComputedStyle(img); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none'; })
            .map(img => img.decode()));
    });
}
for (const journey of ['catalog', 'product', 'about'] as const)
    test(`production navigation ${journey}`, async ({ browser }, info) => {
        test.skip(process.env.RUN_UX127_BENCHMARK !== '1', 'Separate controlled production benchmark, not the functional E2E gate');
        if (!process.env.UX127_BENCHMARK_RESULTS || !process.env.UX127_BENCHMARK_RUN_ID || !process.env.UX127_APP_WORKTREE)
            throw Error('Explicit benchmark output/run/worktree required');
        const requestedRounds = Number(process.env.UX127_BENCHMARK_ROUNDS ?? '3');
        if (!Number.isInteger(requestedRounds) || requestedRounds < 1 || requestedRounds > 10) throw new Error('Benchmark rounds must be 1-10.');
        fs.mkdirSync(process.env.UX127_BENCHMARK_RESULTS, { recursive: true });
        const persist = () => fs.writeFileSync(path.resolve(process.env.UX127_BENCHMARK_RESULTS!, `samples-${info.project.name}-${journey}.json`), JSON.stringify(samples.filter(s => s.journey === journey && s.project === info.project.name), null, 2));
        const origin = info.project.use.baseURL;
        if (!origin) throw new Error('Explicit benchmark origin is required.');
        for (let round = 0; round < requestedRounds; round++) {
            const context = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
            await context.addInitScript(() => localStorage.setItem('ll_cookie_consent', JSON.stringify({ essential: true, analytics: false })));
            const page = await context.newPage();
            const observer = new NextCancellationObserver({ testedSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.env.UX127_APP_WORKTREE, encoding: 'utf8' }).trim(), runId: process.env.UX127_BENCHMARK_RUN_ID, origin });
            await observer.observe(page);
            let phase = 'source';
            const inFlight = new Set<Request>();
            const observedFailures: Array<Record<string, unknown>> = [];
            page.on('request', request => {
                const headers = request.headers();
                const prefetch = headers.rsc === '1' && (headers['next-router-prefetch'] === '1' || Boolean(headers['next-router-segment-prefetch']));
                if (!prefetch) inFlight.add(request);
            });
            page.on('requestfinished', request => inFlight.delete(request));
            page.on('requestfailed', request => {
                inFlight.delete(request); const url = new URL(request.url()); const headers = request.headers();
                const imageSource = url.pathname === '/_next/image' ? new URL(url.searchParams.get('url') ?? '/', origin).pathname : undefined;
                observedFailures.push({ method: request.method(), path: url.pathname, imageSource, resource: request.resourceType(), error: request.failure()?.errorText, phase, rsc: headers.rsc === '1', prefetch: headers['next-router-prefetch'] === '1' || Boolean(headers['next-router-segment-prefetch']) });
            });
            const writeDiagnostic = (network?: Awaited<ReturnType<NextCancellationObserver['finish']>>) => fs.writeFileSync(path.resolve(process.env.UX127_BENCHMARK_RESULTS!, `diagnostic-${info.project.name}-${journey}-${round}.json`), JSON.stringify({ testedSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.env.UX127_APP_WORKTREE, encoding: 'utf8' }).trim(), runId: process.env.UX127_BENCHMARK_RUN_ID, phase, observedFailures, unresolved: network?.unresolved.map(item => ({ method: item.method, path: item.path, resource: item.resource, error: item.error })), typedNextCancellations: network?.expectedNextCancellations.length }, null, 2));
            const drain = async () => { await page.waitForLoadState('networkidle', { timeout: 15_000 }); await settleVisibleImages(page); await expect.poll(() => inFlight.size, { timeout: 15_000, message: 'Actual non-prefetch requests must settle before sample reset/teardown' }).toBe(0); };
            const failures: Array<{ type: string; message?: string; path?: string; status?: number }> = [];
            page.on('pageerror', () => failures.push({ type: 'pageerror', message: 'Browser page exception; inspect private runner output' }));
            page.on('console', m => { if (m.type() === 'error')
                failures.push({ type: 'console', message: 'Browser console error; inspect private runner output' }); });
            page.on('response', r => { if (r.status() >= 400)
                failures.push({ type: 'http', path: new URL(r.url()).pathname, status: r.status() }); });
            // CDP throttling preserves browser cache, unlike page.route(), which disables it.
            const cdp = await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 120, downloadThroughput: 1250000, uploadThroughput: 125000 });
            for (const cache of ['cold', 'warm']) {
                phase = 'source';
                await page.goto(journey === 'product' ? '/en/products' : '/en');
                await expect(page.locator('h1').first()).toBeVisible();
                await drain(); // Outside the pointer measurement, before source preparation.
                let target: Locator;
                let destination: string;
                if (journey === 'catalog') {
                    target = page.locator('a[href="/en/products"]').filter({ visible: true }).first();
                    destination = '/en/products';
                }
                else if (journey === 'product') {
                    target = page.locator('article a[href^="/en/products/"]').first();
                    const href = await target.getAttribute('href');
                    if (!href) throw new Error('Product link has no destination.');
                    destination = href;
                }
                else {
                    const toggle = page.getByRole('button', { name: 'Open navigation menu', exact: true });
                    if (await toggle.isVisible()) {
                        await toggle.click();
                        target = page.getByRole('dialog').getByRole('link', { name: 'About', exact: true });
                    }
                    else
                        target = page.locator('header a[href="/en/about"]').first();
                    destination = '/en/about';
                }
                destination = new URL(destination, origin).href;
                await target.scrollIntoViewIfNeeded();
                const token = `${journey}-${round}-${cache}`;
                await target.evaluate((el, t) => el.dataset.qaProbe = t, token);
                const box = await target.boundingBox();
                if (!box) throw new Error('Benchmark trigger has no visible geometry.');
                await page.mouse.move(box.x + Math.min(box.width / 2, 40), box.y + Math.min(box.height / 2, 30));
                await page.waitForTimeout(180);
                await page.evaluate(({ token, destination }) => {
                    const state: Probe = { token, destination, start: null, feedback: null, fallback: null, useful: null, completed: null };
                    window.__uxProbe = state;
                    const visible = (el: Element | null) => { if (!el)
                        return false; const b = el.getBoundingClientRect(), s = getComputedStyle(el); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && s.visibility !== 'hidden' && Number(s.opacity) >= .1; };
                    const trigger = document.querySelector(`[data-qa-probe="${token}"]`);
                    const controls = [trigger, trigger?.closest('article') ?? null].filter((element): element is Element => element !== null);
                    const appearance = (el: Element) => { const s = getComputedStyle(el); return [s.transform, s.backgroundColor, s.boxShadow].join('|'); };
                    const initial = controls.map(appearance);
                    const stable: Record<string, number> = {};
                    let completedFrames = 0;
                    document.addEventListener('pointerdown', () => { state.start = performance.now(); }, { once: true, capture: true });
                    function frame() {
                        if (state.start !== null) {
                            const now = performance.now() - state.start;
                            const el = document.querySelector(`[data-qa-probe="${token}"]`);
                            const pressed = Boolean(el && el.matches(':active') && controls.some((control, index) => appearance(control) !== initial[index]));
                            const pending = [...document.querySelectorAll('[data-pending="true"],[data-testid="mobile-navigation-pending"]')].some(visible);
                            const fallback = [...document.querySelectorAll('[data-testid$="loading"],[data-testid*="skeleton"]')].some(visible);
                            const useful = location.href === destination && visible(document.querySelector('main h1')) && !fallback;
                            const conditions = { feedback: pressed || pending, fallback, useful };
                            for (const key of ['feedback', 'fallback', 'useful'] as const) {
                                const value = conditions[key];
                                stable[key] = value ? (stable[key] || 0) + 1 : 0;
                                if (stable[key] >= 2 && state[key] === null)
                                    state[key] = now;
                            }
                            completedFrames = useful && !document.querySelector('[aria-busy="true"]') ? completedFrames + 1 : 0;
                            if (completedFrames >= 2) {
                                state.completed = now;
                                return;
                            }
                        }
                        requestAnimationFrame(frame);
                    }
                    requestAnimationFrame(frame);
                }, { token, destination });
                phase = 'activation';
                await page.mouse.down();
                await page.waitForTimeout(50);
                await page.mouse.up();
                await expect(page).toHaveURL(destination);
                await expect(page.locator('main h1')).toBeVisible();
                await page.waitForFunction(() => Boolean(window.__uxProbe && window.__uxProbe.completed !== null));
                phase = 'destination'; writeDiagnostic();
                await observer.assertDestination(page, { expectedUrl: destination, assertions: [{ name: 'Exact production destination and visible useful content', status: 'PASS', details: 'Exact URL and paint-stable main heading asserted after a trusted pointer press.' }] });
                const metrics = await page.evaluate(() => window.__uxProbe);
                samples.push({ testedSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.env.UX127_APP_WORKTREE, encoding: 'utf8' }).trim(), runId: process.env.UX127_BENCHMARK_RUN_ID, inputModel: 'controlled 50ms mouse pointer press on desktop/mobile viewport emulation, not physical touch', browserVersion: browser.version(), backend: 'isolated Supabase', runtime: 'next start production + owned HTTPS proxy', network: { latencyMs: 120, downloadBytesPerSecond: 1250000, uploadBytesPerSecond: 125000 }, cacheDefinition: cache === 'cold' ? 'fresh browser context; normal prefetch allowed' : 'same context repeat after full document navigation; browser HTTP cache available; router cache retention not claimed', completionDefinition: 'destination h1 paint-stable for two frames with no route fallback/aria-busy; not full media completion', journey, round, requestedRounds, cache, project: info.project.name, viewport: await page.viewportSize(), metrics, failures: [...failures] });
                persist(); writeDiagnostic();
                await info.attach(token + '.json', { body: JSON.stringify(samples.at(-1), null, 2), contentType: 'application/json' });
                expect(failures, 'Unexpected page/console/HTTP failures; inspect baseline before comparison').toEqual([]);
                phase = 'sample-drain'; await drain();
                if (round === 0)
                    await page.screenshot({ path: info.outputPath(`${journey}-${cache}.png`), animations: 'disabled' });
            }
            phase = 'observer-finalization';
            const network = await observer.finish();
            writeDiagnostic(network); persist();
            expect.soft(network.unresolved.length, 'Unclassified failed network requests; inspect sanitized path diagnostics (overall benchmark remains FAIL)').toBe(0);
            for (const sample of samples.filter(s => s.journey === journey && s.round === round && s.project === info.project.name))
                sample.networkDiagnostics = { unresolvedCount: network.unresolved.length, typedNextCancellations: network.expectedNextCancellations.length, closedPrefetches: network.closedPrefetches.length, failures: network.failedNetworkRequests.map(r => ({ path: r.path ?? r.requestPath, method: r.method, disposition: r.disposition })) };
            persist();
            await context.close();
        }
        fs.mkdirSync(process.env.UX127_BENCHMARK_RESULTS, { recursive: true });
        fs.writeFileSync(path.resolve(process.env.UX127_BENCHMARK_RESULTS, `samples-${info.project.name}-${journey}.json`), JSON.stringify(samples.filter(s => s.journey === journey && s.project === info.project.name), null, 2));
    });
