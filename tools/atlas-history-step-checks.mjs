import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const [runtimePath, chromePath] = process.argv.slice(2);
if (!runtimePath) throw new Error('Pass the existing Playwright entry and optional Chrome executable.');
const { chromium } = await import(pathToFileURL(runtimePath).href);
await mkdir('output/checks/reports', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
const report = { passed: true, results: [], boundary: 'Disposable localhost collections/native IndexedDB, real pointer button input, synthetic Chrome adapters. No installed profile data.' };
const assert = (value, message) => { if (!value) throw new Error(message); };
try {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 320, height: 400 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }), page = await context.newPage();
    const row = { viewport, passed: false, earlier: 0, later: 0 };
    try {
      await page.route('**/*', async route => {
        if (route.request().resourceType() !== 'document') return route.continue();
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:" } });
      });
      await page.goto('http://localhost:8232/tools/screenshot-harness.html?time-machine&theme=spaceblack');
      await page.locator('.folder-toggle').first().waitFor();
      const seeded = await page.evaluate(async () => {
        const { createAtlasHistoryDatabase } = await import('/extension/lib/atlas-history-db.js');
        const { ATLAS_HISTORY_LIMITS } = await import('/extension/lib/atlas-history-model.js');
        const { createAtlasHistoryService, ATLAS_HISTORY_PREFIX } = await import('/extension/lib/atlas-history-service.js');
        const current = await chrome.storage.local.get(['folders', 'deferred']), name = 'atlas-ui-step-' + crypto.randomUUID();
        const previous = createAtlasHistoryDatabase({ name, limits: { ...ATLAS_HISTORY_LIMITS, checkpointEvents: 500, checkpointMs: Number.MAX_SAFE_INTEGER } });
        const state = structuredClone(current), times = [], start = Date.now() - 1000;
        state.deferred.push({ id: 'step-test-only', folderId: null, url: 'https://example.com/step-snapshot', title: '', completed: false });
        try {
          for (let index = 0; index < 250; index++) {
            state.deferred.at(-1).title = `Moment ${index}`;
            times.push((await previous.append(state, { wallTime: start + index })).time);
          }
        } finally { previous.close(); }
        const database = createAtlasHistoryDatabase({ name }), owner = createAtlasHistoryService(chrome, { database });
        const send = chrome.runtime.sendMessage.bind(chrome.runtime), sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('index.html'), tab: { id: 999, windowId: 1 } };
        chrome.runtime.sendMessage = request => request.type?.startsWith(ATLAS_HISTORY_PREFIX) ? owner.handleMessage(request, sender) : send(request);
        await owner.start(); times.push((await database.status()).latest);
        window.stepTestCleanup = async () => { database.close(); await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = () => reject(request.error); }); };
        return { times, original: JSON.stringify(current) };
      });
      await page.locator('#customizeToggle').click(); await page.locator('#contextMenu button').filter({ hasText: 'Time machine…' }).click();
      const idle = () => page.waitForFunction(() => !document.querySelector('[data-tm][data-busy]') && document.querySelector('.tm-loading')?.hidden && document.querySelector('#timeMachineDialog')?.getAttribute('aria-busy') === 'false' && document.querySelector('.tm-columns')?.getAttribute('aria-busy') !== 'true' && document.querySelector('.tm-navigator')?.getAttribute('aria-busy') === 'false');
      await idle();
      const readWindow = () => page.locator('.tm-navigator').evaluate(root => ({ start: Number(root.dataset.start), end: Number(root.dataset.end), date: document.querySelector('.tm-date').dateTime }));
      await page.locator('#tmRange').focus(); await page.keyboard.press('Home'); await idle();
      for (let index = 0; index < 20 && !await page.locator('[data-nav="zoom-in"]').isDisabled(); index++) {
        await page.locator('#tmRange').focus(); await page.keyboard.press('+'); await idle();
      }
      const minimum = await readWindow();
      assert(minimum.end - minimum.start === 1000 && await page.locator('[data-nav="zoom-in"]').isDisabled(), 'Zoom does not stop at one second');
      await page.locator('#tmRange').focus(); await page.keyboard.press('+'); await idle();
      const ruler = await page.locator('.tm-ruler').boundingBox();
      await page.mouse.move(ruler.x + ruler.width * .4, ruler.y + 85); await page.mouse.wheel(0, -90); await idle();
      assert(JSON.stringify(await readWindow()) === JSON.stringify(minimum), 'Keyboard/wheel zoom drifts below the one-second limit');
      const cluster = page.locator('.tm-moment-cluster').first();
      assert(await cluster.count() > 0 && (await cluster.getAttribute('aria-label')).includes('Use Earlier, Later'), 'Dense subsecond snapshots lack a navigation hint');
      await cluster.click(); await idle();
      assert(JSON.stringify(await readWindow()) === JSON.stringify(minimum) && await page.locator('#tmRange').evaluate(target => target === document.activeElement), 'Cluster at minimum zoom changes the window or fails to focus exact navigation');
      await page.keyboard.press('ArrowRight'); await idle();
      assert(await page.locator('.tm-date').getAttribute('datetime') === new Date(seeded.times[1]).toISOString(), 'Arrow skips a subsecond snapshot at minimum zoom');
      await page.keyboard.press('ArrowLeft'); await idle();
      assert(await page.locator('.tm-date').getAttribute('datetime') === new Date(seeded.times[0]).toISOString(), 'Reverse arrow skips a subsecond snapshot');
      row.minimumZoomMs = minimum.end - minimum.start;
      await page.keyboard.press('End'); await idle();
      for (const direction of ['earlier', 'later']) {
        const expected = direction === 'earlier' ? seeded.times.slice(0, -1).reverse() : seeded.times.slice(1);
        for (const time of expected) {
          await page.locator(`[data-tm="${direction}"]`).click(); await idle();
          assert(await page.locator('.tm-date').getAttribute('datetime') === new Date(time).toISOString(), `${direction} repeated/skipped a moment at ${row[direction]}`);
          const index = seeded.times.indexOf(time);
          if (index < 250) assert(await page.locator('.tm-tab-title').filter({ hasText: new RegExp(`^Moment ${index}$`) }).count() === 1, 'Date changed without the corresponding snapshot contents');
          row[direction]++;
        }
        assert(await page.locator(`[data-tm="${direction}"]`).isDisabled(), `${direction} does not stop at its true endpoint`);
      }
      assert(await page.evaluate(async () => JSON.stringify(await chrome.storage.local.get(['folders', 'deferred']))) === seeded.original, 'Navigation changed collections');
      row.passed = true;
    } catch (error) { row.error = error.message; report.passed = false; }
    finally { await page.evaluate(() => window.stepTestCleanup?.()).catch(() => {}); await context.close(); report.results.push(row); }
  }
  const page = await browser.newPage();
  await page.goto('http://localhost:8232/tools/atlas-history-checks.html'); await page.locator('#run').click();
  await page.waitForFunction(() => { try { return JSON.parse(document.querySelector('#results').textContent).running === false; } catch { return false; } }, null, { timeout: 120000 });
  const native = JSON.parse(await page.locator('#results').textContent());
  await writeFile('output/checks/reports/atlas-history-step-native.json', JSON.stringify(native, null, 2));
  report.native = { passed: native.passed, count: native.results.length };
  if (!native.passed) report.passed = false;
} finally { await browser.close(); }
await writeFile('output/checks/reports/atlas-history-step-ui.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
