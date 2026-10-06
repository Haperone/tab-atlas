import { createAtlasHistoryController } from '../extension/lib/atlas-history-ui.js';
import { ATLAS_HISTORY_LIMITS } from '../extension/lib/atlas-history-model.js';

const find = selector => document.querySelector(selector), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const percentile95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
const output = find('#atlasHistoryPerformanceResults'), summary = find('#summary'), run = find('#run');
let worker, sequence = 0, controller, phase = 'idle';
const pending = new Map(), longTasks = [];
let observer;
if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
  observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push({ phase, startTime: entry.startTime, duration: entry.duration }); });
  observer.observe({ type: 'longtask', buffered: false });
}
async function rpc(payload) {
  return await new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Worker measurement timed out during ' + payload.action)); }, 60000);
    pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, ...payload });
  });
}
function launchWorker() {
  worker = new Worker('./atlas-history-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    const entry = pending.get(data.id); if (!entry) return; clearTimeout(entry.timer); pending.delete(data.id);
    data.error ? entry.reject(new Error(data.error)) : entry.resolve(data.result);
  };
  worker.onerror = event => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(event.message)); } pending.clear();
  };
}
async function until(predicate) {
  for (let index = 0; index < 3000; index++) { if (predicate()) return; await wait(10); }
  throw new Error('Useful preview timed out');
}
const deleteDB = name => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Disposable measurement database cleanup blocked'));
});
window.chrome = { runtime: { onMessage: { addListener() {} }, sendMessage: request => rpc({ action: 'command', request }) } };
controller = createAtlasHistoryController();
run.addEventListener('click', async () => {
  run.disabled = true;
  const report = { running: true, results: [], longTaskObservationAvailable: !!observer,
    environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory, width: innerWidth, height: innerHeight },
    boundary: 'Actual Worker and native IndexedDB; production Atlas service/controller; postMessage transport and a separate fixture IDB substitute for Chrome runtime/local. Main-thread long tasks include the controller flow; Worker CPU and browser overhead are separate.' };
  const write = () => { output.textContent = JSON.stringify(report, null, 2); summary.textContent = `${report.results.length} measurement groups${report.running ? ' · Running…' : ' · Finished'}`; };
  for (const count of [100, 1000, 10000]) {
    const name = 'tab-atlas-collections-performance-' + crypto.randomUUID(), result = { count, errors: [] };
    try {
      launchWorker();
      summary.textContent = `Preparing ${count.toLocaleString()} links near ${ATLAS_HISTORY_LIMITS.budget / 1024 / 1024} MiB…`;
      phase = `seed-${count}`; await rpc({ action: 'init', name });
      result.seed = await rpc({ action: 'performance-seed', count, nearBudget: true });
      assert(result.seed.payloadRatio >= .90 && result.seed.payloadRatio <= 1, 'History was not near its configured payload budget');
      assert(result.seed.audit.recorded === result.seed.audit.measured && !result.seed.audit.missing.length, 'History ledger is not exact');
      const seekMs = [];
      phase = `worker-seek-${count}`;
      for (let index = 0; index < 20; index++) {
        const started = performance.now(), response = await rpc({ action: 'command', request: { type: 'tab-atlas/time-machine/seek', time: result.seed.previewTimes[index % 2] } });
        assert(response.ok && response.data.state.deferred.length === count, 'Worker seek lost links'); seekMs.push(performance.now() - started);
      }
      result.workerRoundTripP95Ms = percentile95(seekMs); result.workerRoundTripSamplesMs = seekMs;
      const useful = [], entry = [], openLongTaskStart = performance.now(); phase = `preview-${count}`;
      for (let index = 0; index < 20; index++) {
        controller.close(); const started = performance.now(); const opened = controller.open();
        await opened;
        assert(!find('.tm-card') && find('[data-tm="restore-all"]').hidden && find('.tm-state-message').textContent.includes('matches your Atlas'), 'Latest moment is not a truthful matching state');
        entry.push(performance.now() - started);
        find('[data-tm="earlier"]').click();
        await until(() => find('.tm-card .tm-tab') && find('.tm-count').textContent.endsWith(` · ${count} links`)
          && find('.tm-loading').hidden && find('.tm-error').hidden);
        useful.push(performance.now() - started);
        assert([...find('.tm-cards').querySelectorAll('.tm-card')].every(card => card.querySelector('.tm-row')?.dataset.presence === 'missing'), 'Recovery preview does not prioritize missing links');
        assert(find('.tm-cards').children.length <= 12 && find('.tm-cards').querySelectorAll('.tm-row').length <= 120, 'Initial DOM was not lazy');
      }
      result.usefulPreviewP95Ms = percentile95(useful); result.usefulPreviewSamplesMs = useful;
      result.entryPreviewP95Ms = percentile95(entry); result.entryPreviewSamplesMs = entry;
      result.previewFlow = 'Open latest matching state, then Earlier to the preceding recovery moment; useful preview includes both actions.';
      const cold = []; phase = `cold-preview-${count}`;
      summary.textContent = `Checking ${count.toLocaleString()} links after Worker restart…`;
      for (let index = 0; index < 20; index++) {
        controller.close(); worker.terminate(); const started = performance.now(); launchWorker();
        await rpc({ action: 'init', name }); const opened = controller.open();
        await opened;
        assert(!find('.tm-card') && find('[data-tm="restore-all"]').hidden && find('.tm-state-message').textContent.includes('matches your Atlas'), 'Restart lost the latest matching state');
        find('[data-tm="earlier"]').click();
        await until(() => find('.tm-card .tm-tab') && find('.tm-count').textContent.endsWith(` · ${count} links`)
          && find('.tm-loading').hidden && find('.tm-error').hidden);
        cold.push(performance.now() - started);
      }
      result.coldUsefulPreviewP95Ms = percentile95(cold); result.coldUsefulPreviewSamplesMs = cold;
      await wait(20); const closedAt = performance.now();
      result.previewLongTasks = longTasks.filter(task => task.startTime >= openLongTaskStart && task.startTime <= closedAt);
      result.maximumPreviewTaskMs = Math.max(0, ...result.previewLongTasks.map(task => task.duration));
      result.rendererHeap = performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit, estimateOnly: true } : null;
      result.originEstimate = await navigator.storage.estimate();
      controller.close(); phase = `restore-gc-${count}`;
      result.restoreAndGC = await rpc({ action: 'performance-restore-gc' });
      assert(result.restoreAndGC.localCommits === 2, 'Restore/Undo rewrote collections more than once');
      assert(result.restoreAndGC.earliestAfterGC > result.restoreAndGC.earliestBeforeGC, 'Near-budget churn did not exercise trimming');
      assert(result.restoreAndGC.audit.measured === result.restoreAndGC.audit.recorded && !result.restoreAndGC.audit.missing.length, 'GC ledger/protected records damaged');
      if (count === 1000 && result.workerRoundTripP95Ms > 250) result.errors.push('1,000-link seek p95 exceeds 250 ms');
      if (result.usefulPreviewP95Ms > 1000) result.errors.push('Useful preview p95 exceeds 1,000 ms');
      if (result.coldUsefulPreviewP95Ms > 1000) result.errors.push('Useful preview after Worker restart p95 exceeds 1,000 ms');
      if (result.maximumPreviewTaskMs > 50) result.errors.push('Main-thread preview task exceeds 50 ms');
      result.passed = !result.errors.length;
    } catch (error) { result.errors.push(error.message); result.passed = false; }
    finally {
      controller.close(); worker?.terminate(); phase = 'cleanup';
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Measurement worker closed')); } pending.clear();
      await deleteDB(name); await deleteDB(name + '-local'); report.results.push(result); write();
    }
  }
  report.running = false; report.passed = report.results.every(result => result.passed); run.disabled = false; write();
});
