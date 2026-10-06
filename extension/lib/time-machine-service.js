import { createTimeMachineDatabase } from './time-machine-db.js';
import { captureHistoryState, emptyHistoryState, reduceChromeHistory, diffHistoryStates } from './time-machine-model.js';
import { createTimeMachineRestorer } from './time-machine-restore.js';

export const TIME_MACHINE_PREFIX = 'tab-atlas/time-machine/';
const PREFERENCES_KEY = 'timeMachinePreferences';
const EPOCH_KEY = 'tab-atlas-time-machine-epoch';
const relevantUpdate = info => ['url', 'title', 'pinned', 'groupId'].some(field => Object.hasOwn(info, field));

/** Event queue owns writes across dashboard tabs and worker reactivation. */
export function createTimeMachineService(chromeApi, { database = createTimeMachineDatabase(), clock = Date.now,
  key = () => crypto.randomUUID(), notify = () => {} } = {}) {
  const queue = [];
  let running = false, ready = null, model = emptyHistoryState();
  let enabled = false, paused = false, stopped = null, epoch = null;
  const restorer = createTimeMachineRestorer(chromeApi, database, { getEpoch:()=>epoch, notify, clock });

  async function snapshot(previous = model) {
    const windows = await chromeApi.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const groups = chromeApi.tabGroups?.query ? await chromeApi.tabGroups.query({}) : [];
    return captureHistoryState(windows, groups, previous, key);
  }
  function announce() { try { notify(); } catch {} }
  async function initialize() {
    const preferences = (await chromeApi.storage.local.get(PREFERENCES_KEY))[PREFERENCES_KEY];
    await database.maintain?.();
    const status = await database.status();
    enabled = preferences?.enabled ?? status.enabled;
    paused = preferences?.paused ?? status.paused; stopped = status.stopped;
    const session = await chromeApi.storage.session.get(EPOCH_KEY);
    epoch = session[EPOCH_KEY];
    if (!epoch) { epoch = key(); await chromeApi.storage.session.set({ [EPOCH_KEY]: epoch }); }
    await restorer.recover();
    try { model = await database.current(); }
    catch(error) {
      model=emptyHistoryState();
      stopped='History could not be read. Retry or clear history from its options. Saved links are unchanged.';
      try { await database.configure({stopped}); } catch {}
      return; // Keep status and explicit Clear usable without silently discarding history.
    }
    if (!enabled || paused || stopped) return;
    const boundary = epoch !== status.epoch || !status.oldest;
    const captured = await snapshot(boundary ? emptyHistoryState() : model);
    try{
      await database.configure({ enabled, paused, epoch });
      // A worker wake with missed changes is a reconciliation boundary, not invented events.
      const changed = Object.keys(diffHistoryStates(model, captured)).length > 0;
      if (boundary || changed) await database.append(captured, { boundary: true, kind: boundary ? 'session' : 'reconciled', wallTime: clock() });
      model = captured;
    }catch(error){await stopForError(error);} // Keep status and explicit Clear available.
  }
  async function ensureReady() {
    if (!ready) ready = initialize();
    try { await ready; } catch (error) { ready = null; throw error; }
  }
  async function drain() {
    running = true;
    while (queue.length) {
      const item = queue.shift();
      try { await ensureReady(); item.resolve(await item.action()); }
      catch (error) { item.reject(error); }
    }
    running = false;
  }
  function enqueue(action) {
    return new Promise((resolve, reject) => { queue.push({ action, resolve, reject }); if (!running) void drain(); });
  }
  async function stopForError(error) {
    stopped = error.code === 'BUDGET' || error.name === 'QuotaExceededError'
      ? 'Not enough space for history. Clear older history and resume recording. Saved links are unchanged.'
      : 'History recording was interrupted. Retry from Time machine. Saved links are unchanged.';
    try { await database.configure({ stopped }); } catch {}
    announce();
  }
  async function persist(next, options = {}) {
    try {
      const result = await database.append(next, { wallTime: clock(), ...options });
      model = next;
      if (result.changed) announce();
    } catch (error) { await stopForError(error); }
  }
  async function ensureWindow(id) {
    if (Object.values(model.windows).some(window => window.chromeId === id)) return;
    try {
      const window = await chromeApi.windows.get(id);
      model = reduceChromeHistory(model, { type: 'window-created', window }, key);
    } catch {} // Window can close before the event is consumed.
  }
  function accept(event) {
    const captured = structuredClone(event), wallTime = clock(), operationId=restorer.operationId();
    return enqueue(async () => {
      if (!enabled || paused || stopped) return;
      if (captured.type === 'replace-lookup') {
        try { captured.tab = await chromeApi.tabs.get(captured.id); captured.type = 'replaced'; }
        catch { captured.type = 'removed'; captured.id = captured.oldId; }
      }
      if (captured.type === 'group-lookup') {
        captured.type = 'group-updated';
        try { captured.tabIds = (await chromeApi.tabs.query({ groupId:captured.group.id })).filter(tab => !tab.incognito).map(tab => tab.id); }
        catch {} // The group can disappear while its event is queued.
      }
      if (captured.tab?.incognito || captured.window?.incognito) return;
      if(captured.type==='removed' && !Object.values(model.tabs).some(tab=>tab.chromeId===captured.id) &&
        !captured.isWindowClosing && Object.values(model.windows).some(window=>window.chromeId===captured.windowId)){
        const next=await snapshot();
        if(Object.keys(diffHistoryStates(model,next)).length)await persist(next,{boundary:true,kind:'reconciled',wallTime});
        return;
      }
      if (captured.tab) await ensureWindow(captured.tab.windowId);
      if (captured.type === 'attached') await ensureWindow(captured.windowId);
      if (captured.group) await ensureWindow(captured.group.windowId);
      const next = reduceChromeHistory(model, captured, key);
      await persist(next, { kind: captured.type, wallTime, operationId });
    });
  }
  function receive(event) { void accept(event).catch(error => { void stopForError(error); }); }

  async function configure(action) {
    if (action === 'enable' || action === 'resume') { enabled = true; paused = false; stopped = null; }
    if (action === 'pause') paused = true;
    if (action === 'disable') { enabled = false; paused = true; }
    await chromeApi.storage.local.set({ [PREFERENCES_KEY]: { enabled, paused } });
    await database.configure({ enabled, paused, stopped, epoch });
    if (enabled && !paused) {
      const next = await snapshot(emptyHistoryState());
      // Returning from a pause starts a new independent interval.
      await persist(next, { boundary: true, kind: action });
      if (globalThis.navigator?.storage?.persist) {
        try { await navigator.storage.persist(); } catch {}
      }
    }
    announce(); return await database.status();
  }

  async function handleMessage(request, sender) {
    if (!request?.type?.startsWith(TIME_MACHINE_PREFIX)) return null;
    const dashboardUrl = chromeApi.runtime.getURL('index.html');
    if (sender?.id !== chromeApi.runtime.id || sender?.tab?.incognito ||
      !(sender?.url === dashboardUrl || sender?.url?.startsWith(`${dashboardUrl}?`) || sender?.url?.startsWith(`${dashboardUrl}#`))) {
      return { ok: false, error: 'Open Time machine from Tab Atlas to use this action.', code: 'FORBIDDEN' };
    }
    try {
      const action = request.type.slice(TIME_MACHINE_PREFIX.length);
      if (['prepare-restore','start-restore','stop-restore','undo-restore','open-tab'].includes(action)) {
        await ensureReady();
        let data;
        if(action==='prepare-restore')data=await restorer.prepare(request.time,request.keys,sender.tab?.windowId);
        if(action==='start-restore')data=await restorer.start(request.id,request.confirmed===true);
        if(action==='stop-restore')data=await restorer.stop(request.id);
        if(action==='undo-restore')data=await restorer.undo(request.id);
        if(action==='open-tab')data=await restorer.openTab(request.time,request.key);
        return {ok:true,data};
      }
      const data = await enqueue(async () => {
        if (['enable', 'pause', 'resume', 'disable'].includes(action)) return await configure(action);
        if (action === 'status') {
          await database.maintain?.();
          let currentStatus=await database.status();
          if(enabled&&!paused&&!stopped&&!currentStatus.oldest){
            await persist(await snapshot(emptyHistoryState()),{boundary:true,kind:'session'});
            currentStatus=await database.status();
          }
          return { ...currentStatus, stopped, lastRestore:await restorer.statusOperation(currentStatus.lastRestore) };
        }
        if (action === 'seek') {
          if (!Number.isFinite(request.time) || request.time < 0) throw new Error('Choose an available time and retry.');
          return await database.seek(request.time);
        }
        if (action === 'step') {
          const byTime=Object.hasOwn(request,'time');
          if (![-1, 1].includes(request.direction) || (byTime ? !Number.isFinite(request.time) || request.time<0 : !Number.isSafeInteger(request.seq))) throw new Error('Choose an earlier or later state.');
          return await database.step(byTime ? null : request.seq, request.direction, byTime ? request.time : null);
        }
        if (action === 'clear') {
          if(restorer.operationId())throw new Error('Wait for the restore or Undo to finish before clearing history.');
          await database.clear(); model = emptyHistoryState(); stopped = null;
          if (enabled && !paused) await persist(await snapshot(emptyHistoryState()), { boundary:true, kind:'cleared' });
          announce(); return await database.status();
        }
        throw new Error('This history action is unavailable. Reload Tab Atlas and retry.');
      });
      return { ok: true, data };
    } catch (error) { return { ok: false, error: error.message || 'Unable to load history. Retry.', code: error.code || 'HISTORY_ERROR' }; }
  }

  function register() {
    const observe = (type,id,info,tab) => {
      const action=()=>restorer.observeStored(type,id,info,tab);
      // Cold event delivery must wait until the browser epoch is known.
      void (epoch ? action() : enqueue(action)).catch(() => {});
    };
    chromeApi.tabs.onCreated.addListener(tab => receive({ type:'created', tab }));
    chromeApi.tabs.onRemoved.addListener((id,info={}) => receive({ type:'removed', id, windowId:info.windowId,isWindowClosing:info.isWindowClosing }));
    chromeApi.tabs.onUpdated.addListener((id, info, tab) => { observe('updated',id,info,tab); if (relevantUpdate(info)) receive({ type:'updated', tab }); });
    chromeApi.tabs.onMoved.addListener((id, info) => { observe('moved',id); receive({ type:'moved', id, index:info.toIndex }); });
    chromeApi.tabs.onDetached.addListener(id => receive({ type:'detached', id }));
    chromeApi.tabs.onAttached.addListener((id, info) => { observe('attached',id); receive({ type:'attached', id, windowId:info.newWindowId, index:info.newPosition }); });
    chromeApi.tabs.onActivated.addListener(info => { observe('activated',info.tabId); receive({ type:'activated', id:info.tabId }); });
    chromeApi.tabs.onReplaced.addListener((id, oldId) => {
      receive({ type:'replace-lookup', id, oldId });
    });
    chromeApi.windows.onCreated.addListener(window => receive({ type:'window-created', window }));
    chromeApi.windows.onRemoved.addListener(id => receive({ type:'window-removed', id }));
    const groupChanged = group => receive({ type:'group-lookup', group });
    chromeApi.tabGroups?.onCreated.addListener(groupChanged);
    chromeApi.tabGroups?.onUpdated.addListener(groupChanged);
    chromeApi.tabGroups?.onRemoved.addListener(group => receive({ type:'group-removed', id:group.id }));
    chromeApi.runtime.onStartup.addListener(() => {
      void enqueue(async () => {
        const stored=(await chromeApi.storage.session.get(EPOCH_KEY))[EPOCH_KEY];
        const fresh= !stored || stored!==epoch;
        if(!stored){epoch=key();await chromeApi.storage.session.set({[EPOCH_KEY]:epoch});}
        else epoch=stored;
        await database.configure({ epoch });
        if (enabled && !paused && !stopped) {
          const captured=await snapshot(fresh ? emptyHistoryState() : model);
          if(fresh || Object.keys(diffHistoryStates(model,captured)).length)await persist(captured,{boundary:true,kind:fresh?'session':'reconciled'});
        }
      }).catch(error => { void stopForError(error); });
    });
  }

  function start() { return enqueue(async () => {}); }
  return { register, start, accept, handleMessage, database };
}
