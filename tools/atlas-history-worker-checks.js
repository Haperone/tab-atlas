import { atlasRecordJSON, captureAtlasState, captureAtlasHistoryState } from '../extension/lib/atlas-history-model.js';

const button = document.querySelector('#run'), summary = document.querySelector('#summary'), output = document.querySelector('#results');
const assert = (value, message) => { if (!value) throw new Error(message); };
const equal = (actual, expected) => assert(atlasRecordJSON(actual) === atlasRecordJSON(expected), 'Values differ');
const state = values => captureAtlasState(values);
const seed = () => ({
  past: { folders: [{ id: 'f', name: 'Work', color: 'green' }], deferred: [
    { id: 'old', folderId: 'f', url: 'https://worker.example/old', title: 'Old', completed: false },
    { id: 'archive', folderId: 'f', url: 'https://worker.example/archive', completed: true, completedAt: '2025-01-01T00:00:00Z' }] },
  current: { folders: [{ id: 'f', name: 'Work', color: 'blue' }, { id: 'other', name: 'Other' }], deferred: [
    { id: 'new', folderId: 'f', url: 'https://worker.example/new', title: 'New', completed: false },
    { id: 'outside', folderId: 'other', url: 'https://worker.example/outside', completed: false }],
  workspaceSnapshots: [{ id: 'workspace', name: 'Keep' }], theme: 'spaceblack' },
});
function transport(name) {
  let worker, sequence = 0, boundary = null;
  const pending = new Map();
  function terminate() {
    worker?.terminate();
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Fixture worker terminated')); }
    pending.clear();
  }
  function launch() {
    worker = new Worker('./atlas-history-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.event === 'boundary') { boundary?.resolve(data); boundary = null; return; }
      const entry = pending.get(data.id); if (!entry) return;
      pending.delete(data.id); clearTimeout(entry.timer);
      data.error ? entry.reject(new Error(data.error)) : entry.resolve(data.result);
    };
    worker.onerror = event => {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(event.message)); }
      pending.clear();
    };
  }
  async function call(payload) {
    return await new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Fixture Worker timed out')); }, 60000);
      pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, ...payload });
    });
  }
  const raw = (prefix, action, values = {}) => call({ action: 'command', request: { type: prefix + action, ...values } });
  async function command(prefix, action, values) {
    const result = await raw(prefix, action, values); assert(result.ok, result.error); return result.data;
  }
  return { launch, terminate, call, raw,
    history: (action, values) => command('tab-atlas/time-machine/', action, values),
    collection: (action, values) => command('tab-atlas/collections/', action, values),
    async start(values) { launch(); return await call({ action: 'init', name, ...(values ? { seed: values } : {}) }); },
    async interrupt(point, operationId, request) {
      const reached = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { boundary = null; reject(new Error('Durable boundary not reached: ' + point)); }, 15000);
        boundary = { resolve: value => { clearTimeout(timer); resolve(value); } };
      });
      await call({ action: 'arm', point, operationId });
      // Consume the rejected RPC when termination deliberately loses its response.
      const lost = this.history('restore', request).catch(error => ({ interrupted: error.message }));
      const marker = await reached; terminate(); await lost; return marker;
    },
  };
}
async function deleteDB(name) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve;
    request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Fixture database cleanup blocked'));
  });
}
button.addEventListener('click', async () => {
  button.disabled = true;
  const report = { running: true, passed: 0, results: [],
    environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency },
    boundary: 'Actual Worker termination/postMessage/native IDB. Atomic fixture local storage is a separate IDB database, not chrome.storage.local. No installed extension or browser restart proof.' };
  const render = () => { output.textContent = JSON.stringify(report, null, 2); summary.textContent = `${report.passed}/${report.results.length} passed${report.running ? ' · Running…' : ''}`; };
  async function check(name, action) {
    const dbName = 'tab-atlas-collections-worker-test-' + crypto.randomUUID(), rpc = transport(dbName);
    try { const evidence = await action(rpc); report.results.push({ name, pass: true, evidence }); report.passed++; }
    catch (error) { report.results.push({ name, pass: false, error: error.message, ...(error.evidence ? { evidence: error.evidence } : {}) }); }
    finally { rpc.terminate(); await deleteDB(dbName); await deleteDB(dbName + '-local'); render(); }
  }
  try {
    for (const point of ['prepared', 'local-receipt', 'target-recorded', 'committed']) await check('Restart after durable ' + point, async rpc => {
      const values = seed(); await rpc.start(values);
      const preview = await rpc.history('preview-restore', { time: 1000 });
      const request = { id: 'restore-one', time: 1000, expectedRevision: preview.revision };
      const marker = await rpc.interrupt(point, request.id, request); await rpc.start();
      const recovered = await rpc.call({ action: 'inspect', operationId: request.id });
      const committed = point !== 'prepared';
      equal(state(recovered.local.values), committed ? captureAtlasHistoryState(values.past) : state(values.current));
      equal(recovered.local.values.workspaceSnapshots, values.current.workspaceSnapshots);
      assert(recovered.local.values.theme === values.current.theme, 'Restore changed theme');
      assert(!recovered.pending, 'Recovery did not settle preparation');
      assert(recovered.operation.phase === (committed ? 'committed' : 'abandoned'), 'False recovery result');
      assert(recovered.local.commits === (committed ? 1 : 0), 'Recovery replayed local write');
      assert(recovered.audit.measured === recovered.audit.recorded && !recovered.audit.missing.length, 'Native history ledger/records damaged');
      if (!committed) {
        const retry = await rpc.raw('tab-atlas/time-machine/', 'restore', request);
        assert(!retry.ok && retry.code === 'OPERATION_USED', 'Abandoned id was reused');
      } else {
        const repeated = await rpc.history('restore', request);
        assert(repeated.alreadyCommitted, 'Lost response retried the mutation');
        const afterRetry = await rpc.call({ action: 'inspect' });
        assert(afterRetry.status.latestSeq === recovered.status.latestSeq && afterRetry.local.commits === 1, 'Retry created duplicate commit/history');
        const undo = await rpc.history('preview-undo', { operationId: request.id });
        await rpc.history('undo', { id: 'undo-one', operationId: request.id, expectedRevision: undo.revision });
        rpc.terminate(); await rpc.start();
        const returned = await rpc.call({ action: 'inspect', operationId: 'undo-one' });
        equal(state(returned.local.values), state(values.current)); equal(returned.operation.before, captureAtlasHistoryState(values.past));
        assert(returned.status.lastRestore.id === 'undo-one' && returned.local.commits === 2, 'Durable Undo was lost');
        assert((await rpc.history('undo', { operationId: request.id })).alreadyUndone, 'Repeated Undo changed newer data');
        assert(returned.local.values.atlasArchiveProtection && !returned.local.values.quickSaveUndo, 'Replacement metadata missing');
      }
      return { point: marker.point, committed, recoveredSeq: recovered.status.latestSeq, localCommitsAtRecovery: recovered.local.commits };
    });
    for (const mode of ['replace', 'merge', 'copy']) await check('Folder ' + mode + ' and durable Undo', async rpc => {
      const values = seed(); await rpc.start(values);
      const selection = { folderIds: ['f'] }, unresolved = await rpc.history('preview-restore', { time: 1000, selection });
      assert(unresolved.status === 'conflict' && !unresolved.target, 'Folder conflict silently chose a mode');
      const choices = { folderChoices: { f: { mode, targetId: 'f' } } };
      const preview = await rpc.history('preview-restore', { time: 1000, selection, choices });
      assert(preview.status === 'ready', 'Explicit choice did not resolve folder');
      await rpc.history('restore', { id: 'folder-' + mode, time: 1000, selection, choices, expectedRevision: preview.revision });
      const restored = await rpc.collection('read'), collections = restored.collections;
      equal(collections.folders.find(folder => folder.id === 'other'), values.current.folders[1]);
      equal(collections.deferred.find(link => link.id === 'outside'), values.current.deferred[1]);
      if (mode === 'replace') assert(!collections.deferred.some(link => link.id === 'new') && collections.folders[0].color === 'green', 'Replacement kept newer folder contents');
      if (mode === 'merge') assert(collections.deferred.some(link => link.id === 'new') && collections.folders[0].color === 'blue', 'Merge replaced current edits');
      if (mode === 'copy') {
        const copy = collections.folders.find(folder => folder.name === 'Restored · Work');
        assert(copy && copy.id !== 'f', 'Copy prefix/identity missing');
        equal(collections.folders[0], values.current.folders[0]);
        assert(collections.deferred.filter(link => link.folderId === copy.id).length === 1, 'Copy lost active member or included archive');
      }
      rpc.terminate(); await rpc.start();
      const undo = await rpc.history('preview-undo', { operationId: 'folder-' + mode });
      await rpc.history('undo', { operationId: 'folder-' + mode, expectedRevision: undo.revision });
      equal(state((await rpc.collection('read')).collections), state(values.current));
      return { mode, restoredLinks: collections.deferred.length, copiedName: preview.folders[0].name };
    });
    await check('Concurrent message intents, stale preview and confirmed Undo preserve newer edits', async rpc => {
      const values = seed(); await rpc.start(values);
      await Promise.all([1, 2].map(index => rpc.collection('save', { page: { url: 'https://worker.example/concurrent-' + index, title: 'Concurrent ' + index }, folderId: 'f' })));
      const current = await rpc.collection('read'); assert(current.collections.deferred.length === 4, 'Concurrent save lost a confirmed link');
      const stale = await rpc.history('preview-restore', { time: 1000 });
      await rpc.collection('folder-edit', { id: 'f', fields: { name: 'New name' } });
      const rejected = await rpc.raw('tab-atlas/time-machine/', 'restore', { id: 'stale', time: 1000, expectedRevision: stale.revision });
      assert(!rejected.ok && rejected.code === 'REVISION_CONFLICT', 'Stale preview overwrote a newer edit');
      const before = await rpc.collection('read'), preview = await rpc.history('preview-restore', { time: 1000 });
      await rpc.history('restore', { id: 'changed', time: 1000, expectedRevision: preview.revision });
      await rpc.collection('save', { page: { url: 'https://worker.example/after-restore', title: 'Keep newer edit' }, folderId: 'f' });
      const newer = await rpc.collection('read'); rpc.terminate(); await rpc.start();
      const undo = await rpc.history('preview-undo', { operationId: 'changed' }); assert(undo.changedSinceRestore, 'Undo missed newer revision');
      const unconfirmed = await rpc.raw('tab-atlas/time-machine/', 'undo', { operationId: 'changed', expectedRevision: undo.revision });
      assert(!unconfirmed.ok && unconfirmed.code === 'UNDO_CHANGED', 'Undo silently removed newer edits');
      equal(state((await rpc.collection('read')).collections), state(newer.collections));
      await rpc.history('undo', { id: 'confirmed-undo', operationId: 'changed', expectedRevision: undo.revision, confirmChanged: true });
      equal(state((await rpc.collection('read')).collections), state(before.collections));
      equal((await rpc.call({ action: 'inspect', operationId: 'confirmed-undo' })).operation.before, state(newer.collections));
      return { concurrentLinks: current.collections.deferred.length, staleCode: rejected.code, undoConflict: unconfirmed.code };
    });
    await check('Popup/context save and Undo journal through the shared writer without a dashboard', async rpc => {
      const values = seed(); await rpc.start(values);
      const initial = await rpc.history('status');
      const quick = async (action, fields = {}) => {
        const result = await rpc.call({ action: 'quick-command', request: {
          type: 'tab-atlas/quick-save/' + action, tabId: 20, ...fields } });
        assert(result.ok, result.error); return result;
      };
      const journalMatches = async expectedSeq => {
        const status = await rpc.history('status');
        assert(status.latestSeq === expectedSeq, 'Missing or duplicate automatic history point');
        equal((await rpc.history('seek', { time: status.latest })).state,
          state((await rpc.collection('read')).collections));
      };
      const saved = await quick('save', { folderId: 'f', notify: true });
      assert(saved.changed, 'Popup save did not commit');
      await journalMatches(initial.latestSeq + 1);
      assert(!(await quick('save', { folderId: 'f', notify: true })).changed, 'Repeated save changed collections');
      await journalMatches(initial.latestSeq + 1);
      const context = await rpc.call({ action: 'context-save',
        info: { menuItemId: 'tab-atlas-save-page:folder:f' },
        page: { id: 21, title: 'Context fixture', url: 'https://worker.example/context' } });
      assert(context.ok && context.changed, 'Context save did not commit');
      await journalMatches(initial.latestSeq + 2);
      await quick('undo', { undoId: context.undoId });
      await journalMatches(initial.latestSeq + 3);
      const [created] = await Promise.all([
        quick('create-folder', { name: 'Popup created', notify: true }),
        rpc.collection('save', { page: { title: 'Dashboard fixture', url: 'https://worker.example/dashboard' }, folderId: 'other' }),
      ]);
      await journalMatches(initial.latestSeq + 5);
      const beforeRestart = state((await rpc.collection('read')).collections);
      assert(beforeRestart.folders.some(folder => folder.name === 'Popup created')
        && beforeRestart.deferred.some(link => link.url === 'https://worker.example/dashboard'), 'Concurrent writers lost confirmed data');
      const feedback = (await rpc.call({ action: 'inspect' })).feedback;
      assert(feedback.receipts === 4 && feedback.saveSounds === 3 && feedback.undoSounds === 1,
        'Shared writer changed receipt/sound requests');
      rpc.terminate(); await rpc.start();
      await journalMatches(initial.latestSeq + 5);
      equal(state((await rpc.collection('read')).collections), beforeRestart);
      const preview = await rpc.history('preview-restore', { time: 1000 });
      await rpc.history('restore', { id: 'quick-replacement', time: 1000, expectedRevision: preview.revision });
      const stale = await rpc.call({ action: 'quick-command', request: {
        type: 'tab-atlas/quick-save/undo', undoId: created.undoId } });
      assert(!stale.ok && stale.error === 'UNDO_GONE', 'Popup Undo changed replacement collections');
      equal(state((await rpc.collection('read')).collections), captureAtlasHistoryState(values.past));
      return { newPoints: 5, repeatedSavePoints: 0, feedback, staleUndo: stale.error,
        boundary: 'Production services in actual Worker/native IDB; Chrome popup/menu dispatch, injection and audio are fixture adapters.' };
    });
    await check('1,000-link seek replays 199 events within p95 target', async rpc => {
      await rpc.start(); const evidence = await rpc.call({ action: 'performance-bounded-replay' });
      const roundTrips = [];
      for (let index = 0; index < 20; index++) {
        const started = performance.now(), moment = await rpc.history('seek', { time: 10199 });
        assert(moment.state.deferred.length === 1000 && moment.state.deferred[0].id === 'link-999'
          && moment.state.deferred.every(link => !link.completed), 'Service seek lost active order/links or retained archive');
        roundTrips.push(performance.now() - started);
      }
      evidence.serviceRoundTripSamplesMs = roundTrips;
      evidence.p95ServiceRoundTripMs = [...roundTrips].sort((a, b) => a - b)[18];
      if (evidence.p95SeekMs > 250 || evidence.p95ServiceRoundTripMs > 250) {
        const error = new Error(`Bounded 1,000-link replay exceeded 250 ms p95: native ${evidence.p95SeekMs.toFixed(1)} ms, service ${evidence.p95ServiceRoundTripMs.toFixed(1)} ms`);
        error.evidence = evidence; throw error;
      }
      return evidence;
    });
  } catch (error) { report.results.push({ name: 'Fixture infrastructure', pass: false, error: error.message }); }
  report.running = false; button.disabled = false; render();
});
