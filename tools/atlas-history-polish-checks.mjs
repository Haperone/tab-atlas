import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { THEME_OPTIONS } from '../extension/lib/view-config.js';

// Disposable native IndexedDB. Usage is injected metadata, never a full user disk.
const [runtimePath, chromePath] = process.argv.slice(2);
if (!runtimePath) throw new Error('Pass the existing Playwright entry and optional Chrome executable.');
const { chromium } = await import(pathToFileURL(runtimePath).href);
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
const report = { passed: true, results: [], boundary: 'Isolated localhost Chrome/native IndexedDB/synthetic Chrome adapters. Capacity metadata is injected; RTL and long captions are fixture stress checks. Reflow is not native browser zoom, speech or installed MV3 evidence.' };
const assert = (value, message) => { if (!value) throw new Error(message); };
const directory = 'output/checks/screenshots/second-review';
await mkdir('output/checks/reports', { recursive: true });
await mkdir(directory, { recursive: true });
try {
  for (const theme of THEME_OPTIONS) for (const viewport of [{ width: 1024, height: 500 }, { width: 320, height: 400 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' }), page = await context.newPage();
    const row = { theme: theme.id, viewport, passed: false };
    try {
      await context.route('**/*', async route => {
        if (!route.request().url().startsWith('http://localhost:8232/')) return route.fulfill({ contentType: 'text/html', body: '<title>Local check</title>' });
        if (route.request().resourceType() !== 'document') return route.continue();
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:" } });
      });
      await page.goto(`http://localhost:8232/tools/screenshot-harness.html?time-machine&history-comparison-preview&theme=${theme.id}`);
      await page.locator('.folder-toggle').first().waitFor();
      const original = await page.evaluate(() => chrome.storage.local.get(['folders', 'deferred']));
      await page.evaluate(() => {
        const send = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = async request => {
          const response = await send(request);
          return request.type === 'tab-atlas/time-machine/status' && response.ok
            ? { ...response, data: { ...response.data, bytes: 190 * 1024 * 1024 } } : response;
        };
      });
      const idle = () => page.waitForFunction(() => document.querySelector('#timeMachineDialog')?.getAttribute('aria-busy') === 'false' && document.querySelector('.tm-loading')?.hidden && document.querySelector('.tm-columns')?.getAttribute('aria-busy') !== 'true');
      await page.locator('#customizeToggle').click(); await page.locator('#contextMenu button').filter({ hasText: 'Time machine…' }).click(); await idle();
      await page.locator('[data-tm="earlier"]').click(); await idle();
      assert(await page.locator('.tm-capacity-title').textContent().then(text => text.includes('95%')), 'Critical warning is absent');
      await page.locator('.tm-folder-choice').last().scrollIntoViewIfNeeded();
      row.geometry = await page.locator('.tm-columns').evaluate(target => target.getBoundingClientRect().toJSON());
      assert(row.geometry.height > 0, 'Warning erases the history lists');
      const choice = page.locator('.tm-link-choice').last();
      await choice.click({ position: { x: 2, y: 2 } });
      const check = choice.locator('input'); assert(await check.isChecked(), 'Padded label misses the checkbox');
      const selectedTitle = await choice.locator('..').locator('.tm-tab-title').textContent();
      const dock = await page.locator('.tm-restore-dock').boundingBox();
      assert(dock.y >= 0 && dock.y + dock.height <= viewport.height, 'Warning clips the selected restore action');
      await page.locator('[data-tm="restore-selected"]').click();
      const modal = page.locator('.tm-confirm[open]'); await modal.waitFor();
      if (await modal.locator('input[value="parent"]').count()) {
        await modal.locator('input[value="parent"]').check();
        await modal.getByRole('button', { name: 'Review restoration', exact: true }).click();
      }
      await modal.locator('.tm-review-links').waitFor();
      assert(await modal.locator('.tm-review-links').textContent().then(text => text.includes(selectedTitle)), 'Confirmation omits the selected link');
      await page.keyboard.press('Escape'); await idle();
      await choice.scrollIntoViewIfNeeded();
      const selectedBounds = await check.boundingBox(), contentBounds = await page.locator('.tm-scroll').boundingBox();
      assert(selectedBounds.y >= contentBounds.y && selectedBounds.y + selectedBounds.height <= contentBounds.y + contentBounds.height, 'Selected checkbox stays hidden behind fixed chrome');
      if (['spaceblack', 'pearlglass', 'papersoft'].includes(theme.id)) await page.screenshot({ path: `${directory}/${theme.id}-${viewport.width}-selected.png` });
      await page.locator('[data-tm="clear-selection"]').click();
      await page.locator('.tm-guide > summary').click();
      await page.locator('.tm-guide-content > p').last().scrollIntoViewIfNeeded();
      assert(await page.locator('.tm-guide-content').evaluate(target => target.scrollWidth <= target.clientWidth + 1), 'Expanded guide overflows');
      await page.locator('.tm-guide > summary').click();
      await page.evaluate(() => {
        document.documentElement.dir = 'rtl';
        document.querySelector('.tm-restore-all span').textContent += ' — Ｒｅｓｔｏｒｅ ｆｏｌｄｅｒｓ ａｎｄ ｓａｖｅｄ ｌｉｎｋｓ';
      });
      row.growth = await page.locator('.tm-header-actions button').evaluateAll(targets => targets.filter(target => !target.hidden && target.getClientRects().length).map(target => {
        const rect = target.getBoundingClientRect(); return { name: target.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflow: target.scrollWidth > target.clientWidth + 1 };
      }));
      assert(row.growth.every(target => !target.overflow && target.left >= 0 && target.right <= viewport.width && target.top >= 0 && target.bottom <= viewport.height), 'Header labels clip in RTL or with longer copy');
      assert(await page.locator('.tm-scroll').evaluate(target => target.clientHeight > 0), 'Long header removes the scrollable content');
      assert(JSON.stringify(await page.evaluate(() => chrome.storage.local.get(['folders', 'deferred']))) === JSON.stringify(original), 'Review, selection or Cancel changes collections');
      row.passed = true;
    } catch (error) { row.error = error.message; report.passed = false; }
    finally { report.results.push(row); await context.close(); }
  }
} finally { await browser.close(); }
await writeFile('output/checks/reports/atlas-history-second-polish-ui.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, count: report.results.length, failures: report.results.filter(row => !row.passed).map(({ theme, viewport, error }) => ({ theme, viewport, error })) }));
if (!report.passed) process.exitCode = 1;
