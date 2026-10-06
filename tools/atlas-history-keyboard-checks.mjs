import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { THEME_OPTIONS } from '../extension/lib/view-config.js';

// Uses an existing Playwright runtime; no production or project dependency.
const [runtimePath, chromePath] = process.argv.slice(2);
if (!runtimePath) throw new Error('Pass the installed Playwright entry file and optional Chrome executable.');
const { chromium } = await import(pathToFileURL(runtimePath).href);
await mkdir(new URL('../output/checks/reports/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
const report = { passed: true, results: [], boundary: 'Localhost fixture with native IDB and synthetic Chrome adapters; keyboard input and browser-emulated forced colors/reduced motion. Not installed MV3, OS high contrast, real browser zoom or screen-reader speech.' };
try {
  for (const theme of THEME_OPTIONS) for (const viewport of [{ width: 1280, height: 720 }, { width: 320, height: 400 }]) {
    const context = await browser.newContext({ viewport, forcedColors: 'active', reducedMotion: 'reduce' });
    const page = await context.newPage(), result = { theme: theme.id, viewport, passed: false, focusSamples: [] };
    try {
      // Exclude the antivirus scripts injected into HTTP documents on this host.
      await page.route('**/*', async route => {
        if (route.request().resourceType() !== 'document') return route.continue();
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:" } });
      });
      await page.goto('http://localhost:8232/tools/screenshot-harness.html?time-machine&history-comparison-preview&theme=' + encodeURIComponent(theme.id));
      await page.locator('.folder-toggle').first().waitFor();
      await page.locator('#customizeToggle').click();
      await page.locator('#contextMenu button').filter({ hasText: 'Time machine…' }).click();
      const idle = () => page.waitForFunction(() => document.querySelector('#timeMachineDialog')?.getAttribute('aria-busy') === 'false' && document.querySelector('.tm-loading')?.hidden);
      await idle();
      result.media = await page.evaluate(() => ({ forcedColors: matchMedia('(forced-colors: active)').matches, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, theme: document.documentElement.dataset.theme }));
      if (!result.media.forcedColors || !result.media.reducedMotion || result.media.theme !== theme.id) throw new Error('Required media/theme state was not applied');
      const tabTo = async (selector, key = 'Tab') => {
        for (let index = 0; index < 90; index++) {
          await page.keyboard.press(key);
          const sample = await page.evaluate(selector => {
            const element = document.activeElement, style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return { target: element.matches(selector), inModal: !!element.closest('.tm-confirm[open],.tm-dialog[open]'),
              tag: element.tagName, action: element.dataset.tm, name: (element.getAttribute('aria-label') || element.textContent.trim()).slice(0, 180),
              focusVisible: element.matches(':focus-visible'), outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle,
              outlineColor: style.outlineColor, background: style.backgroundColor,
              rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
          }, selector);
          result.focusSamples.push(sample);
          if (!sample.inModal || !sample.focusVisible || sample.outlineWidth < 2 || sample.outlineStyle === 'none') throw new Error('Keyboard focus is trapped incorrectly or has no visible perimeter: ' + JSON.stringify(sample));
          if (sample.rect.left < -1 || sample.rect.right > viewport.width + 1 || sample.rect.top < -1 || sample.rect.bottom > viewport.height + 1) throw new Error('Focused control is clipped: ' + JSON.stringify(sample));
          if (sample.target) return;
        }
        throw new Error('Keyboard cannot reach ' + selector);
      };
      await tabTo('[data-tm="earlier"]'); await page.keyboard.press('Enter');
      await page.locator('.tm-folder-choice input').first().waitFor(); await idle();
      await tabTo('.tm-folder-choice input'); await page.keyboard.press('Space');
      await tabTo('[data-tm="restore-selected"]'); await page.keyboard.press('Enter');
      await page.locator('.tm-confirm[open]').waitFor();
      const cancel = page.locator('.tm-confirm button').filter({ hasText: /^Cancel$/ });
      if (!await cancel.evaluate(element => element === document.activeElement)) throw new Error('Confirmation initially focuses replacement');
      await page.keyboard.press('Escape'); await idle();
      if (!await page.locator('[data-tm="restore-selected"]').evaluate(element => element === document.activeElement)) throw new Error('Cancel lost restore selection focus');
      await tabTo('[data-tm="clear-selection"]', 'Shift+Tab'); await page.keyboard.press('Enter');
      if (!await page.locator('.tm-folder-choice input').first().evaluate(element => element === document.activeElement)) throw new Error('Clear selection lost content focus');
      await page.keyboard.press('Escape');
      if (!await page.locator('#customizeToggle').evaluate(element => element === document.activeElement)) throw new Error('Closing history lost dashboard focus');
      result.passed = true;
    } catch (error) { result.error = error.message; report.passed = false; }
    finally { report.results.push(result); await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(new URL('../output/checks/reports/atlas-history-forced-colors-keyboard.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, count: report.results.length, failures: report.results.filter(row => !row.passed).map(({ theme, viewport, error }) => ({ theme, viewport, error })) }));
if (!report.passed) process.exitCode = 1;
