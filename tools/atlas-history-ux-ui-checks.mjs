import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { THEME_OPTIONS } from '../extension/lib/view-config.js';

// Disposable localhost data only. No installed-extension/profile access.
const [runtimePath, chromePath] = process.argv.slice(2);
if (!runtimePath) throw new Error('Pass the existing Playwright entry and optional Chrome executable.');
const { chromium } = await import(pathToFileURL(runtimePath).href);
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
const report = { passed: true, results: [], boundary: 'Isolated headless Chrome, native IndexedDB and synthetic Chrome adapters. Native link modifiers use locally fulfilled dummy pages. Reflow sizes are not real browser zoom; no installed MV3 or screen-reader speech evidence.' };
const assert = (value, text) => { if (!value) throw new Error(text); };
const directory = 'output/checks/screenshots/review';
await mkdir('output/checks/reports', { recursive: true });
await mkdir(directory, { recursive: true });
try {
  for (const theme of THEME_OPTIONS) for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 500 }, { width: 1920, height: 1080 }, { width: 640, height: 360 }, { width: 320, height: 400 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage(), row = { theme: theme.id, viewport, passed: false };
    try {
      await context.route('**/*', async route => {
        // Modifier-created tabs never contact an external website.
        if (!route.request().url().startsWith('http://localhost:8232/')) return route.fulfill({ contentType: 'text/html', body: '<title>Local historical-link check</title>' });
        if (route.request().resourceType() !== 'document') return route.continue();
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:" } });
      });
      await page.goto(`http://localhost:8232/tools/screenshot-harness.html?time-machine&history-comparison-preview&theme=${theme.id}`);
      await page.locator('.folder-toggle').first().waitFor();
      const enter = async () => { await page.locator('#customizeToggle').click(); await page.locator('#contextMenu button').filter({ hasText: 'Time machine…' }).click(); };
      const idle = () => page.waitForFunction(() => !document.querySelector('[data-tm][data-busy]') && document.querySelector('#timeMachineDialog')?.getAttribute('aria-busy') === 'false' && document.querySelector('.tm-loading')?.hidden && document.querySelector('.tm-columns')?.getAttribute('aria-busy') !== 'true' && document.querySelector('.tm-navigator')?.getAttribute('aria-busy') === 'false');
      await enter(); await idle();
      const original = await page.evaluate(() => chrome.storage.local.get(['folders', 'deferred']));
      assert(await page.locator('.tm-state-message').textContent().then(text => text.includes('Choose an earlier moment')), 'Matching snapshot has no next step');
      await page.locator('[data-tm="earlier"]').click(); await idle();
      const date = await page.locator('.tm-date').getAttribute('datetime');
      assert(await page.locator('.tm-columns').evaluate(target => target.getBoundingClientRect().height > 0), 'History lists collapse in a short window');
      const guide = page.locator('.tm-guide'), guideWasOpen = await guide.evaluate(target => target.open);
      if (!guideWasOpen) await guide.locator('summary').click();
      await page.locator('.tm-guide-content > p').last().scrollIntoViewIfNeeded();
      assert(await page.locator('.tm-guide-content').evaluate(target => target.scrollWidth <= target.clientWidth + 1), 'Help text escapes its readable column');
      if (!guideWasOpen) await guide.locator('summary').click();
      const contentAX = await context.newCDPSession(page); const contentTree = await contentAX.send('Accessibility.getFullAXTree'); await contentAX.detach();
      row.contentControls = contentTree.nodes.filter(target => !target.ignored && ['button', 'link', 'checkbox', 'slider', 'searchbox'].includes(target.role?.value)).map(target => ({ role: target.role.value, name: target.name?.value }));
      assert(row.contentControls.every(target => target.name?.trim()) && row.contentControls.some(target => target.role === 'link') && row.contentControls.some(target => target.role === 'slider'), 'Historical content lacks named native controls');
      await page.locator('.tm-menu summary').click(); await page.locator('.tm-header h2').click();
      assert(!await page.locator('.tm-menu').evaluate(target => target.open), 'Outside pointer leaves options open');
      await page.locator('.tm-menu summary').click(); await page.locator('#tmSearch').focus(); await page.keyboard.press('Escape');
      assert(await page.locator('#timeMachineDialog').evaluate(target => target.open) && !await page.locator('.tm-menu').evaluate(target => target.open), 'Escape outside options closes history');
      assert(await page.locator('.tm-date').getAttribute('datetime') === date, 'Closing options changes the inspected moment');
      const link = page.locator('a.tm-tab').first();
      assert(await link.getAttribute('href') === await link.locator('.tm-tab-meta').textContent(), 'Native link loses the stored address');
      await link.focus(); await page.keyboard.press('Enter'); await idle();
      if (theme.id === 'default' && viewport.width === 1280) {
        row.nativeLinks = [];
        for (const action of [{ modifiers: ['Control'] }, { button: 'middle' }]) {
          const newPage = context.waitForEvent('page', { timeout: 10000 });
          await link.click(action); const tab = await newPage; await tab.waitForLoadState('domcontentloaded');
          assert(tab.url() === await link.getAttribute('href'), 'Native modifier opens another address');
          row.nativeLinks.push({ action, url: tab.url() }); await tab.close();
        }
      }
      // The padding of the label is a real selection target, not just decoration.
      await page.locator('.tm-link-choice').first().click({ position: { x: 2, y: 2 } });
      assert(await page.locator('.tm-link-check').first().isChecked(), 'Checkbox padding does not select its link');
      assert(await page.locator('.tm-row').first().evaluate(target => getComputedStyle(target).boxShadow !== 'none'), 'Selection lacks a persistent visible cue');
      const selectedId = await page.locator('.tm-link-check').first().getAttribute('data-link-id');
      const selectedTitle = await page.locator('a.tm-tab').first().locator('.tm-tab-title').textContent();
      await page.locator('[data-tm="restore-selected"]').click(); await page.locator('.tm-confirm[open]').waitFor();
      const modal = page.locator('.tm-confirm[open]');
      assert(await modal.locator('.tm-review-undo').textContent().then(text => text.includes('Undo')), 'Restore lacks its protected-return explanation');
      assert(await modal.locator('.tm-review-links').textContent().then(text => text.includes(selectedTitle)), 'Restore confirmation does not name the selected link');
      row.actions = await modal.locator('button').evaluateAll(targets => targets.map(target => ({ name: target.textContent, rect: target.getBoundingClientRect().toJSON() })));
      assert(row.actions.every(target => target.rect.top >= 0 && target.rect.bottom <= viewport.height && target.rect.left >= 0 && target.rect.right <= viewport.width), 'Confirmation actions are clipped');
      const ax = await context.newCDPSession(page); const tree = await ax.send('Accessibility.getFullAXTree'); await ax.detach();
      row.controls = tree.nodes.filter(target => !target.ignored && ['button', 'link', 'checkbox', 'radio', 'slider', 'searchbox', 'combobox'].includes(target.role?.value)).map(target => ({ role: target.role.value, name: target.name?.value }));
      assert(row.controls.length && row.controls.every(target => target.name?.trim()), 'Modal has an unnamed accessible control');
      if (viewport.width === 1280) await page.screenshot({ path: `${directory}/${theme.id}-confirmation.png` });
      if (viewport.width === 320 && theme.id === 'spaceblack') await page.screenshot({ path: `${directory}/narrow-confirmation.png` });
      row.labelGrowth = await modal.locator('button').evaluateAll(targets => {
        for (const target of targets) target.textContent += ' — Ｒｅｖｉｅｗ ｅｘｔｅｎｄｅｄ ｃａｐｔｉｏｎ';
        return targets.map(target => ({ rect: target.getBoundingClientRect().toJSON(), overflow: target.scrollWidth > target.clientWidth + 1 }));
      });
      assert(row.labelGrowth.every(target => !target.overflow && target.rect.left >= 0 && target.rect.right <= viewport.width && target.rect.top >= 0 && target.rect.bottom <= viewport.height), 'Expanded confirmation labels clip or escape the viewport');
      await page.keyboard.press('Escape'); await idle();
      assert(await page.locator('[data-tm="restore-selected"]').evaluate(target => target === document.activeElement), 'Cancel loses selected restoration focus');
      await page.locator('[data-tm="clear-selection"]').click(); await idle();
      assert(await page.locator(`.tm-link-check[data-link-id="${selectedId}"]`).evaluate(target => target === document.activeElement && !target.checked), 'Clear jumps away from the selected link');
      await page.locator('.tm-domain-restore').first().click(); await page.locator('.tm-confirm[open]').waitFor();
      await modal.locator('input[value="copy"]').check();
      assert(await modal.locator('.tm-destination').evaluate(target => target.hidden), 'Copy presents an unused destination');
      if (viewport.width === 1280) await page.screenshot({ path: `${directory}/${theme.id}-folder-copy.png` });
      await page.keyboard.press('Escape'); await idle();
      await page.locator('#tmSearch').fill('no such historical item — проверка');
      await page.waitForFunction(() => document.querySelector('.tm-state-message')?.textContent.includes('no such historical item'));
      await page.locator('[data-tm="clear-search"]').click(); await idle();
      assert(await page.locator('#tmSearch').evaluate(target => target === document.activeElement), 'Clear search loses the search focus');
      await page.locator('.tm-menu summary').click(); await page.locator('.tm-menu [data-tm="storage"]').click(); await modal.waitFor();
      assert(await modal.locator('h3').textContent() === 'History storage' && await modal.textContent().then(text => text.includes('including Undo')), 'Storage surface has misleading title or hides Clear consequences');
      await page.keyboard.press('Escape'); await idle();
      assert(JSON.stringify(await page.evaluate(() => chrome.storage.local.get(['folders', 'deferred']))) === JSON.stringify(original), 'Review/Cancel/navigation changes collections');
      if (viewport.width === 1280) await page.screenshot({ path: `${directory}/${theme.id}-overview.png` });
      if ([1024, 1920].includes(viewport.width)) await page.screenshot({ path: `${directory}/${theme.id}-overview-${viewport.width}.png` });
      if (theme.id === 'default' && viewport.width === 1280) {
        await page.evaluate(() => {
          const send = chrome.runtime.sendMessage; let first = true;
          chrome.runtime.sendMessage = request => {
            if (first && request.type === 'tab-atlas/time-machine/step') { first = false; return new Promise(resolve => { window.releaseHistoryStep = () => resolve(send(request)); }); }
            return send(request);
          };
        });
        await page.locator('[data-tm="earlier"]').click(); await page.waitForFunction(() => !!window.releaseHistoryStep);
        assert(await page.locator('#timeMachineDialog').getAttribute('aria-busy') === 'true' && !await page.locator('.tm-loading').evaluate(target => target.hidden), 'A pending date lookup has no immediate loading feedback');
        assert(await page.locator('.tm-link-check').first().isDisabled() && await page.locator('a.tm-tab').first().getAttribute('aria-disabled') === 'true', 'Pending navigation leaves the old snapshot actionable');
        assert(await page.locator('a.tm-tab').first().evaluate(target => !target.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true })) && !target.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))), 'Disabled native links bypass the pending-navigation guard');
        await page.evaluate(() => window.releaseHistoryStep()); await idle(); row.pendingStep = true;
        // A late failure from a closed session must not contaminate the new entry.
        await page.locator('[data-tm="close"]').click();
        await page.evaluate(() => {
          const send = chrome.runtime.sendMessage; let first = true;
          chrome.runtime.sendMessage = request => {
            if (first && request.type === 'tab-atlas/time-machine/status') { first = false; return new Promise(resolve => { window.releaseOldHistoryRead = () => resolve({ ok: false, error: 'Stale closed-session error' }); }); }
            return send(request);
          };
        });
        await enter(); await page.waitForFunction(() => !!window.releaseOldHistoryRead);
        await page.locator('[data-tm="close"]').click(); await enter(); await idle();
        await page.evaluate(() => window.releaseOldHistoryRead()); await page.waitForFunction(() => document.querySelector('.tm-loading')?.hidden);
        assert(await page.locator('.tm-error').evaluate(target => target.hidden), 'Old status failure leaks into reopened history');
        row.staleSession = true;
      }
      row.passed = true;
    } catch (error) { row.error = error.message; report.passed = false; }
    finally { report.results.push(row); await context.close(); }
  }
} finally { await browser.close(); }
await writeFile('output/checks/reports/atlas-history-ux-ui-browser.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, count: report.results.length, failures: report.results.filter(row => !row.passed).map(({ theme, viewport, error }) => ({ theme, viewport, error })) }));
if (!report.passed) process.exitCode = 1;
