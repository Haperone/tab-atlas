import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const [runtimePath, chromePath] = process.argv.slice(2);
if (!runtimePath) throw new Error('Pass the existing Playwright entry file and optional Chrome executable.');
const { chromium } = await import(pathToFileURL(runtimePath).href);
await mkdir('output/checks/reports', { recursive: true });
await mkdir('output/checks/screenshots', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
const report = { passed: true, results: [], boundary: 'Localhost, native IndexedDB and synthetic Chrome adapters. Pointer/keyboard/wheel input in isolated headless Chrome; no installed MV3 or real profile evidence.' };
const assert = (value, text) => { if (!value) throw new Error(text); };
try {
  for (const theme of ['spaceblack', 'auroraglass', 'papersoft']) for (const viewport of [{ width: 1280, height: 720 }, { width: 320, height: 400 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage(), result = { theme, viewport, passed: false };
    try {
      await page.route('**/*', async route => {
        if (route.request().resourceType() !== 'document') return route.continue();
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:" } });
      });
      await page.goto(`http://localhost:8232/tools/screenshot-harness.html?time-machine&history-timeline-preview&theme=${theme}`);
      await page.locator('.folder-toggle').first().waitFor();
      await page.locator('#customizeToggle').click(); await page.locator('#contextMenu button').filter({ hasText: 'Time machine…' }).click();
      const idle = () => page.waitForFunction(() => !document.querySelector('[data-tm][data-busy]') && document.querySelector('.tm-loading')?.hidden && document.querySelector('#timeMachineDialog')?.getAttribute('aria-busy') === 'false' && document.querySelector('.tm-navigator')?.getAttribute('aria-busy') === 'false' && !document.querySelector('.tm-navigator')?.dataset.choosing && document.querySelector('.tm-columns')?.getAttribute('aria-busy') !== 'true');
      await idle();
      const original = await page.evaluate(() => chrome.storage.local.get(['folders', 'deferred']));
      const read = () => page.locator('.tm-navigator').evaluate(root => ({ start: Number(root.dataset.start), end: Number(root.dataset.end), text: root.textContent, date: document.querySelector('.tm-date').dateTime, points: [...root.querySelectorAll('.tm-moment')].map(point => ({ first: Number(point.dataset.time), last: Number(point.dataset.last), count: Number(point.dataset.count) })) }));
      const initial = await read();
      assert(new Date(initial.start).getFullYear() === 2024 && initial.end - initial.start > 86400000 * 700, 'Fixture has no multi-year history');
      assert(initial.text.includes('2024') && initial.text.includes('2025') && initial.points.some(point => point.count >= 80), 'Year anchors or dense snapshot clusters are absent');
      let box = await page.locator('.tm-ruler').boundingBox(); const anchor = .4;
      await page.mouse.move(box.x + box.width * anchor, box.y + 85); await page.mouse.wheel(0, -90); await idle();
      const zoomed = await read(), oldAnchor = initial.start + (initial.end - initial.start) * anchor;
      assert(zoomed.end - zoomed.start < initial.end - initial.start, 'Wheel does not zoom');
      assert(Math.abs((oldAnchor - zoomed.start) / (zoomed.end - zoomed.start) - anchor) < .015, 'Zoom shifts the cursor anchor');
      assert(zoomed.date === initial.date, 'Zoom unexpectedly selects another snapshot');
      box = await page.locator('.tm-ruler').boundingBox();
      await page.mouse.move(box.x + box.width * .55, box.y + 85); await page.mouse.down(); await page.mouse.move(box.x + box.width * .75, box.y + 85, { steps: 8 }); await page.mouse.up(); await idle();
      const panned = await read();
      assert(panned.start < zoomed.start && Math.abs(panned.end - panned.start - zoomed.end + zoomed.start) < 2 && panned.date === initial.date, 'Drag pans incorrectly or loads a snapshot');
      await page.locator('[data-nav="fit"]').click(); await idle();
      const fit = await read(); assert(fit.start === initial.start && fit.end === initial.end, 'Fit does not restore the full available range');
      await page.locator('.tm-year-label').filter({ hasText: /^2025$/ }).click(); await idle();
      const year = await read(); assert(new Date(year.start).getFullYear() === 2025 && new Date(year.end).getFullYear() === 2026 && year.date === initial.date, 'Year anchor does not zoom to its calendar year');
      assert(await page.locator('#tmRange').getAttribute('data-outside') === 'true' && await page.locator('.tm-playhead').evaluate(target => target.hidden), 'An offscreen inspected snapshot is falsely marked at the visible period edge');
      await page.locator('.tm-axis-label').first().click(); await idle();
      const month = await read(); assert(month.end - month.start <= 86400000 * 31 + 3600000 && month.date === initial.date, 'Month anchor opens several months or selects a snapshot');
      await page.locator('[data-nav="fit"]').click(); await idle();
      const dense = fit.points.find(point => point.count >= 80);
      await page.locator(`.tm-moment[data-time="${dense.first}"]`).click(); await idle();
      let detail = await read(); assert(detail.end - detail.start < initial.end - initial.start && detail.date === initial.date, 'Cluster click selects an arbitrary snapshot instead of zooming');
      // Refine the dense burst until at least one exact snapshot has its own target.
      for (let index = 0; index < 10 && detail.points.some(point => point.count > 1); index++) {
        const target = detail.points.reduce((a, b) => b.count > a.count ? b : a);
        await page.locator(`.tm-moment[data-time="${target.first}"]`).click(); await idle(); detail = await read();
      }
      const exact = detail.points.find(point => point.count === 1);
      assert(exact, 'Dense history cannot be refined to an individual snapshot');
      await page.locator(`.tm-moment[data-time="${exact.first}"]`).click(); await idle();
      assert(new Date((await read()).date).getTime() === exact.first, 'Exact point selects another snapshot');
      for (let index = 0; index < 20 && !await page.locator('[data-nav="zoom-in"]').isDisabled(); index++) {
        await page.locator('#tmRange').focus(); await page.keyboard.press('+'); await idle();
      }
      const minimum = await read();
      assert(minimum.end - minimum.start === 1000 && await page.locator('[data-nav="zoom-in"]').isDisabled(), 'Visual zoom does not stop at one second');
      assert(await page.locator('.tm-axis-label').count() > 0 && (await page.locator('.tm-axis-label').evaluateAll(targets => targets.every(target => Number(target.dataset.start) % 1000 === 0 && Number(target.dataset.end) - Number(target.dataset.start) === 1000))), 'Axis still exposes millisecond intervals');
      box = await page.locator('.tm-ruler').boundingBox();
      await page.mouse.move(box.x + box.width * .4, box.y + 85); await page.mouse.wheel(0, -90); await idle();
      const afterWheel = await read();
      assert(afterWheel.start === minimum.start && afterWheel.end === minimum.end && afterWheel.date === minimum.date, 'Wheel zoom drifts at the one-second limit');
      result.minimumZoomMs = minimum.end - minimum.start;
      const expected = await page.evaluate(time => chrome.runtime.sendMessage({ type: 'tab-atlas/time-machine/step', time, direction: 1 }), exact.first);
      await page.locator('#tmRange').focus(); await page.keyboard.press('ArrowRight'); await idle();
      if (expected.data != null) assert(new Date((await read()).date).getTime() === expected.data, 'Arrow key skips an adjacent snapshot');
      const beforeKeyZoom = await read(); await page.keyboard.press('-'); await idle();
      assert((await read()).end - (await read()).start >= beforeKeyZoom.end - beforeKeyZoom.start, 'Keyboard zoom is unavailable');
      await page.keyboard.press('Home'); await idle(); assert(new Date((await read()).date).getTime() === initial.start, 'Home misses the oldest snapshot');
      await page.keyboard.press('End'); await idle(); assert(new Date((await read()).date).getTime() === initial.end, 'End misses the latest snapshot');
      if (await page.locator('[data-nav="fit"]').isVisible()) { await page.locator('[data-nav="fit"]').click(); await idle(); }
      const alignment = value => page.locator('#tmRange').evaluate((range, value) => {
        if (value != null) { range.value = value; range.dispatchEvent(new Event('input', { bubbles: true })); }
        const rect = range.getBoundingClientRect(), head = document.querySelector('.tm-playhead').getBoundingClientRect();
        const headCentre = head.left + head.width / 2, hits = [];
        // Hit-test the native thumb, rather than inferring its centre from our CSS.
        for (let x = headCentre - 20; x <= headCentre + 20; x += .25) if (document.elementFromPoint(x, rect.top + rect.height / 2) === range) hits.push(x);
        return { value: Number(range.value), headCentre, thumbCentre: (hits[0] + hits.at(-1)) / 2, y: rect.top + rect.height / 2 };
      }, value);
      result.alignment = [];
      for (const value of [0, 200, 500, 800, 1000]) {
        const sample = await alignment(value); result.alignment.push(sample);
        assert(Number.isFinite(sample.thumbCentre) && Math.abs(sample.thumbCentre - sample.headCentre) <= 1, 'Native thumb drifts away from the selection line');
      }
      const dragStart = await alignment(), dragDate = (await read()).date;
      box = await page.locator('.tm-ruler').boundingBox();
      await page.mouse.move(dragStart.thumbCentre, dragStart.y); await page.mouse.down();
      for (const fraction of [.8, .5, .2, .07, .93]) {
        await page.mouse.move(box.x + box.width * fraction, dragStart.y, { steps: 4 });
        const sample = await alignment(); result.alignment.push(sample);
        assert(Math.abs(sample.value / 1000 - fraction) < .01 && Number.isFinite(sample.thumbCentre) && Math.abs(sample.thumbCentre - sample.headCentre) <= 1, 'Dragging separates the native thumb and selection line');
        assert((await read()).date === dragDate, 'Scrubbing commits a snapshot before release');
      }
      const dragEnd = await alignment(), dragWindow = await read(), previewTime = dragWindow.start + (dragWindow.end - dragWindow.start) * dragEnd.value / 1000;
      const nearest = await page.evaluate(time => chrome.runtime.sendMessage({ type: 'tab-atlas/time-machine/nearest', time: Math.round(time) }), previewTime);
      await page.mouse.up(); await idle();
      assert(new Date((await read()).date).getTime() === nearest.data, 'Releasing the thumb does not choose the previewed nearest snapshot');
      const committed = await alignment(); result.alignment.push(committed);
      assert(Math.abs(committed.thumbCentre - committed.headCentre) <= 1, 'A committed snapshot shifts the native thumb from its playhead');
      const geometry = await page.locator('.tm-navigator').evaluate(root => [...root.querySelectorAll('button,input')].filter(target => target.getClientRects().length).map(target => ({ name: target.getAttribute('aria-label') || target.labels?.[0]?.textContent || target.textContent, rect: target.getBoundingClientRect().toJSON() })));
      assert(geometry.every(target => target.name && target.rect.left >= -1 && target.rect.right <= viewport.width + 1 && target.rect.width >= 24), 'Timeline targets have no accessible name, spill horizontally, or are too small');
      assert(JSON.stringify(await page.evaluate(() => chrome.storage.local.get(['folders', 'deferred']))) === JSON.stringify(original), 'Timeline navigation changes current collections');
      result.geometry = geometry; result.passed = true;
      if (viewport.width === 1280) {
        if (await page.locator('[data-nav="fit"]').isVisible()) { await page.locator('[data-nav="fit"]').click(); await idle(); }
        await page.screenshot({ path: `output/checks/screenshots/atlas-timeline-${theme}.png` });
        await page.locator('.tm-timeline').screenshot({ path: `output/checks/screenshots/atlas-timeline-ruler-${theme}.png` });
        const points = (await read()).points, largest = points.reduce((a, b) => b.count > a.count ? b : a);
        await page.locator(`.tm-moment[data-time="${largest.first}"]`).click(); await idle();
        await page.screenshot({ path: `output/checks/screenshots/atlas-timeline-detail-${theme}.png` });
      }
    } catch (error) { result.passed = false; result.error = error.message; report.passed = false; }
    finally { report.results.push(result); await context.close(); }
  }
  const page = await browser.newPage();
  await page.goto('http://localhost:8232/tools/atlas-history-checks.html'); await page.locator('#run').click();
  await page.waitForFunction(() => { try { return JSON.parse(document.querySelector('#results').textContent).running === false; } catch { return false; } }, null, { timeout: 120000 });
  const native = JSON.parse(await page.locator('#results').textContent());
  await writeFile('output/checks/reports/atlas-history-timeline-native.json', JSON.stringify(native, null, 2));
  if (!native.passed) report.passed = false;
  console.log(JSON.stringify({ native: { passed: native.passed, count: native.results.length, failures: native.results.filter(row => !row.passed) } }));
} finally { await browser.close(); }
await writeFile('output/checks/reports/atlas-history-timeline-ui.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, count: report.results.length, failures: report.results.filter(row => !row.passed) }));
if (!report.passed) process.exitCode = 1;
