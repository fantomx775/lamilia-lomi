import { createRequire } from 'node:module';
const loadCommonJs = createRequire(import.meta.url);
const { NextCancellationObserver } = loadCommonJs('./helpers/next-navigation-cancellations.ts');
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const samples = [];
async function settleVisibleImages(page) { await expect.poll(() => page.locator('img').evaluateAll(images => images.filter(img => { const b = img.getBoundingClientRect(); return img.loading !== 'lazy' || (b.bottom > 0 && b.top < innerHeight); }).every(img => img.complete && img.naturalWidth > 0)), { timeout: 15000, message: 'Source/destination images settle before resetting a navigation sample' }).toBe(true); }
for (const journey of ['catalog', 'product', 'about'])
    test(`production navigation ${journey}`, async ({ browser }, info) => {
        test.skip(process.env.RUN_UX127_BENCHMARK !== '1', 'Separate controlled production benchmark, not the functional E2E gate');
        if (!process.env.UX127_BENCHMARK_RESULTS || !process.env.UX127_BENCHMARK_RUN_ID || !process.env.UX127_APP_WORKTREE)
            throw Error('Explicit benchmark output/run/worktree required');
        for (let round = 0; round < 3; round++) {
            const context = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
            await context.addInitScript(() => localStorage.setItem('ll_cookie_consent', JSON.stringify({ essential: true, analytics: false })));
            const page = await context.newPage();
            const observer = new NextCancellationObserver({ testedSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.env.UX127_APP_WORKTREE, encoding: 'utf8' }).trim(), runId: process.env.UX127_BENCHMARK_RUN_ID, origin: info.project.use.baseURL });
            await observer.observe(page);
            const failures = [];
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
                await page.goto(journey === 'product' ? '/en/products' : '/en');
                await expect(page.locator('h1').first()).toBeVisible();
                await settleVisibleImages(page);
                let target, destination;
                if (journey === 'catalog') {
                    target = page.locator('a[href="/en/products"]').filter({ visible: true }).first();
                    destination = '/en/products';
                }
                if (journey === 'product') {
                    target = page.locator('article a[href^="/en/products/"]').first();
                    destination = await target.getAttribute('href');
                }
                if (journey === 'about') {
                    const toggle = page.getByRole('button', { name: 'Open navigation menu', exact: true });
                    if (await toggle.isVisible()) {
                        await toggle.click();
                        target = page.getByRole('dialog').getByRole('link', { name: 'About', exact: true });
                    }
                    else
                        target = page.locator('header a[href="/en/about"]').first();
                    destination = '/en/about';
                }
                destination = new URL(destination, info.project.use.baseURL).href;
                await target.scrollIntoViewIfNeeded();
                const token = `${journey}-${round}-${cache}`;
                await target.evaluate((el, t) => el.dataset.qaProbe = t, token);
                const box = await target.boundingBox();
                await page.mouse.move(box.x + Math.min(box.width / 2, 40), box.y + Math.min(box.height / 2, 30));
                await page.waitForTimeout(180);
                await page.evaluate(({ token, destination }) => {
                    const state = window.__uxProbe = { token, destination, start: null, feedback: null, fallback: null, useful: null, completed: null };
                    const visible = el => { if (!el)
                        return false; const b = el.getBoundingClientRect(), s = getComputedStyle(el); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && s.visibility !== 'hidden' && Number(s.opacity) >= .1; };
                    const trigger = document.querySelector(`[data-qa-probe="${token}"]`);
                    const controls = [trigger, trigger?.closest('article')].filter(Boolean);
                    const appearance = el => { const s = getComputedStyle(el); return [s.transform, s.backgroundColor, s.boxShadow].join('|'); };
                    const initial = controls.map(appearance);
                    const stable = {};
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
                            for (const [key, value] of Object.entries({ feedback: pressed || pending, fallback, useful })) {
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
                await page.mouse.down();
                await page.waitForTimeout(50);
                await page.mouse.up();
                await expect(page).toHaveURL(destination);
                await expect(page.locator('main h1')).toBeVisible();
                await page.waitForFunction(() => window.__uxProbe?.completed !== null);
                await observer.assertDestination(page, { expectedUrl: destination, assertions: [{ name: 'Exact production destination and visible useful content', status: 'PASS', details: 'Exact URL and paint-stable main heading asserted after a trusted pointer press.' }] });
                const metrics = await page.evaluate(() => window.__uxProbe);
                samples.push({ testedSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.env.UX127_APP_WORKTREE, encoding: 'utf8' }).trim(), runId: process.env.UX127_BENCHMARK_RUN_ID, inputModel: 'controlled 50ms mouse pointer press on desktop/mobile viewport emulation, not physical touch', browserVersion: browser.version(), backend: 'isolated Supabase', runtime: 'next start production + owned HTTPS proxy', network: { latencyMs: 120, downloadBytesPerSecond: 1250000, uploadBytesPerSecond: 125000 }, cacheDefinition: cache === 'cold' ? 'fresh browser context; normal prefetch allowed' : 'same context repeat; browser/router caches retained', completionDefinition: 'destination h1 paint-stable for two frames with no route fallback/aria-busy; not full media completion', journey, round, cache, project: info.project.name, viewport: await page.viewportSize(), metrics, failures: [...failures] });
                await info.attach(token + '.json', { body: JSON.stringify(samples.at(-1), null, 2), contentType: 'application/json' });
                expect(failures, 'Unexpected page/console/HTTP failures; inspect baseline before comparison').toEqual([]);
                await settleVisibleImages(page);
                if (round === 0)
                    await page.screenshot({ path: info.outputPath(`${journey}-${cache}.png`), animations: 'disabled' });
            }
            const network = await observer.finish();
            expect(network.unresolved, 'Unclassified failed network requests').toEqual([]);
            for (const sample of samples.filter(s => s.journey === journey && s.round === round && s.project === info.project.name))
                sample.networkDiagnostics = { unresolvedCount: network.unresolved.length, typedNextCancellations: network.expectedNextCancellations.length, closedPrefetches: network.closedPrefetches.length, failures: network.failedNetworkRequests.map(r => ({ path: r.path ?? r.requestPath, method: r.method, disposition: r.disposition })) };
            await context.close();
        }
        fs.mkdirSync(process.env.UX127_BENCHMARK_RESULTS, { recursive: true });
        fs.writeFileSync(path.resolve(process.env.UX127_BENCHMARK_RESULTS, `samples-${info.project.name}-${journey}.json`), JSON.stringify(samples.filter(s => s.journey === journey && s.project === info.project.name), null, 2));
    });
