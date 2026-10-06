import { createAtlasHistoryController } from '../extension/lib/atlas-history-ui.js';

const params = new URLSearchParams(location.search), output = document.querySelector('#disclosureResults');
document.documentElement.dataset.theme = params.get('theme') || 'spaceblack';
const counts = params.has('baseline') ? [10000] : [100, 1000, 10000];
const repetitions = params.has('baseline') ? 3 : 20, pending = new Map(), tasks = [];
let worker, sequence = 0, phase = 'idle';
const assert = (value, message) => { if (!value) throw new Error(message); };
const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const observer = PerformanceObserver.supportedEntryTypes.includes('longtask') ? new PerformanceObserver(list => {
  for (const task of list.getEntries()) tasks.push({ phase, start: task.startTime, duration: task.duration });
}) : null;
observer?.observe({ type: 'longtask' });
const rpc = data => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Fixture Worker timed out')); }, 60000);
  pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, ...data });
});
const until = async test => { const deadline = performance.now() + 60000; while (!test()) { if (performance.now() > deadline) throw new Error('Preview timed out'); await sleep(5); } };
window.chrome = { runtime: { onMessage: { addListener() {} }, sendMessage: request => rpc({ action: 'command', request }) } };
const controller = createAtlasHistoryController();
const idle = () => until(() => document.querySelector('#timeMachineDialog').getAttribute('aria-busy') === 'false'
  && document.querySelector('.tm-loading').hidden && document.querySelector('.tm-columns').getAttribute('aria-busy') !== 'true');
const removeDB = name => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Disposable database is blocked'));
});
document.querySelector('#run').addEventListener('click', async event => {
  event.target.disabled = true;
  const report = { running: true, passed: true, repetitions, results: [], longTaskObservationAvailable: !!observer,
    boundary: 'Native IndexedDB/module Worker, production controller/service, synthetic Chrome/local storage. All historical links missing; not a near-budget or installed MV3 benchmark.',
    viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.theme };
  const publish = () => { output.textContent = JSON.stringify(report, null, 2); };
  publish();
  for (const count of counts) for (const shape of ['inbox', 'folder']) {
    const name = 'atlas-disclosure-' + crypto.randomUUID(), row = { count, shape, samples: [], selectionMs: [], errors: [] };
    try {
      phase = 'seed'; worker = new Worker('./atlas-history-worker.js', { type: 'module' });
      worker.onmessage = ({ data }) => {
        const entry = pending.get(data.id); if (!entry) return; clearTimeout(entry.timer); pending.delete(data.id);
        data.error ? entry.reject(new Error(data.error)) : entry.resolve(data.result);
      };
      const folders = shape === 'folder' ? [{ id: 'lost-folder', name: 'Missing research', color: null, collapsed: false }] : [];
      const past = { folders, deferred: Array.from({ length: count }, (_, index) => ({ id: 'lost-' + index,
        folderId: shape === 'folder' ? 'lost-folder' : null, title: `Historical research ${index} · заметки`,
        url: `https://disclosure.example/research/${index}?original=1#section`, completed: false })) };
      await rpc({ action: 'init', name, seed: { past, current: { folders: [], deferred: [] } } });
      const before = await rpc({ action: 'inspect' });
      for (let index = 0; index < repetitions; index++) {
        document.querySelector('#summary').textContent = `${count} ${shape} · ${index + 1}/${repetitions}`;
        phase = `preview-${count}-${shape}`;
        await controller.open(); await idle();
        const started = performance.now(); document.querySelector('[data-tm="earlier"]').click(); await idle();
        row.samples.push(performance.now() - started);
        const links = [...document.querySelectorAll('.tm-link-check')];
        assert(links.length === count, 'Full disclosure lost historical links');
        assert(links.every(link => link.closest('.tm-row').dataset.presence === 'missing'), 'Missing status or order lost');
        assert(document.querySelector('.tm-more-rows') == null, 'Missing links gained pagination');
        phase = `selection-${count}-${shape}`;
        const selectionStart = performance.now(); links.at(-1).checked = true; links.at(-1).dispatchEvent(new Event('change', { bubbles: true }));
        row.selectionMs.push(performance.now() - selectionStart);
        assert(document.querySelector('.tm-restore-scope').textContent === '1 link' && !document.querySelector('.tm-restore-dock').hidden, 'Last link selection is not reachable');
        controller.close(); await sleep(10);
      }
      const after = await rpc({ action: 'inspect' });
      assert(JSON.stringify(after.local) === JSON.stringify(before.local), 'Browsing or selection wrote collections');
      row.usefulPreviewP95Ms = p95(row.samples); row.selectionP95Ms = p95(row.selectionMs);
      row.longTasks = tasks.filter(task => task.phase.endsWith(`-${count}-${shape}`));
      row.maxTaskMs = Math.max(0, ...row.longTasks.map(task => task.duration));
      if (row.usefulPreviewP95Ms > 1000) row.errors.push('Useful fully exposed preview exceeds 1 second');
      if (row.maxTaskMs >= 50) row.errors.push('UI task reaches 50 ms');
    } catch (error) { row.errors.push(error.message); }
    finally {
      controller.close(); worker?.terminate(); phase = 'cleanup';
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Fixture closed')); } pending.clear();
      await removeDB(name); await removeDB(name + '-local');
      row.passed = !row.errors.length; report.passed &&= row.passed; report.results.push(row); publish();
    }
  }
  report.running = false; event.target.disabled = false; publish();
});
