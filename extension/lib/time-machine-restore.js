import { historyUrl, planHistoryRestore, canUndoHistoryTab, TIME_MACHINE_LIMITS } from './time-machine-model.js';

/** Explicit prepare/start protocol: replaying an expired request cannot create tabs. */
export function createTimeMachineRestorer(api, database, { getEpoch, notify = () => {}, clock = Date.now } = {}) {
  let active = null, initializing = null, undoing = null, undoState = null, lastOutcome = null, unsafeId = null;
  const unsafeKey='tab-atlas-time-machine-unsafe-undo';
  const writes = []; let writing = false;
  async function drain() {
    writing = true;
    while (writes.length) {
      const item = writes.shift();
      try { item.resolve(await item.action()); }
      catch (error) { item.reject(error); }
    }
    writing = false;
  }
  function serialize(action) { return new Promise((resolve,reject) => { writes.push({action,resolve,reject}); if (!writing) void drain(); }); }
  function save(operation) { return serialize(async()=>await database.putOperation(structuredClone(operation))); }
  function changed() { try { notify(); } catch {} }
  async function protectUndo(id) {
    unsafeId=id;
    // One bounded session marker, with no page data, survives a worker restart.
    try { await api.storage?.session?.set({[unsafeKey]:{id,epoch:getEpoch()}}); } catch {}
    changed();
  }
  async function unsafeUndo(id) {
    if(unsafeId===id)return true;
    try{
      const value=(await api.storage?.session?.get(unsafeKey))?.[unsafeKey];
      return value?.id===id && value.epoch===getEpoch();
    }catch{return true;} // Do not close tabs when the safety guard cannot be read.
  }
  function updated(operation) { void save(operation).catch(() => protectUndo(operation.id)); changed(); }
  async function statusOperation(persisted) {
    if(!persisted)return null;
    const current=active?.id===persisted.id?active:persisted.status==='running'&&lastOutcome?.id===persisted.id?lastOutcome:persisted;
    const result=structuredClone(current);
    // Completion is not actionable until the final ownership write has settled.
    if(active?.id===persisted.id)result.status='running';
    result.unsafeUndo=await unsafeUndo(result.id);
    result.undoableCount=result.unsafeUndo?0:persisted.created.filter(tab=>!tab.undone).length;
    if(result.unsafeUndo)result.incompleteUndo=true;
    return result;
  }

  async function liveTabs() {
    const windows = await api.windows.getAll({populate:true,windowTypes:['normal']});
    return windows.filter(w=>!w.incognito).flatMap(w=>(w.tabs || []).filter(t=>!t.incognito));
  }
  async function regularWindow(id) {
    let window;
    try { window=id==null ? await api.windows.getLastFocused({windowTypes:['normal']}) : await api.windows.get(id); } catch {}
    if(!Number.isInteger(window?.id) || window.incognito || window.type!=='normal')throw new Error('Open Tab Atlas in a regular window and select this page again.');
    return window;
  }
  async function prepare(time, keys, windowId) {
    if (active || initializing || undoing) throw new Error('A restore or Undo is running. Wait for it to finish.');
    if (!Number.isFinite(time) || !Array.isArray(keys) || keys.length > 50000 || keys.some(k=>typeof k!=='string')) throw new Error('Choose tabs from an available historical state.');
    const result = await database.seek(time);
    if (result.gap || !result.time) throw new Error('This moment is unavailable. Choose a recorded time.');
    const selected = new Set(keys), stateTabs = Object.values(result.state.tabs).filter(t=>selected.has(t.key)&&!t.detached);
    const plan = planHistoryRestore(result.state,stateTabs.map(t=>t.key),await liveTabs());
    // A single selection belongs beside the dashboard; bulk restore keeps historical windows.
    const targetWindowId=stateTabs.length===1 && plan.tabs.length ? (await regularWindow(windowId)).id : null;
    // Check the eventual ownership payload before any browser mutation.
    const expected = plan.tabs.map(t=>({id:99999999,windowId:99999999,url:t.url,pinned:t.pinned,changed:false,loading:true}));
    if (new TextEncoder().encode(JSON.stringify(expected)).byteLength > TIME_MACHINE_LIMITS.operationReserve / 2) throw new Error('Select fewer tabs for this restore so its Undo can be kept safely.');
    const operation = {id:crypto.randomUUID(),status:'planned',time:result.time,wallTime:result.wallTime ?? result.time,keys:stateTabs.map(t=>t.key),
      epoch:getEpoch(),startedAt:clock(),total:plan.tabs.length,targetWindowId,windowCount:targetWindowId==null?plan.windowCount:0,
      skipped:plan.skipped.length,failed:0,groupFailures:0,created:[],completed:0,needsConfirmation:plan.tabs.length>50};
    await save(operation); return operation;
  }

  async function recover() {
    const last=(await database.status()).lastRestore;
    if (last?.status==='running' && (!active || last.id!==active.id)) {
      last.status='interrupted';last.incompleteUndo=true;
      try{await save(last);}catch{}finally{lastOutcome=structuredClone(last);changed();}
    }
  }
  async function start(id, confirmed = false) {
    if (active?.id===id) return {...structuredClone(active),status:'running'};
    if (active || initializing || undoing) throw new Error('A restore or Undo is already running.');
    initializing = id;
    try {
      const operation=await database.operation(id);
      if (!operation) throw new Error('This restore request has expired. Select the tabs again.');
      if (operation.status!=='planned') return await statusOperation(operation);
      if (operation.epoch!==getEpoch()) throw new Error('The browser session changed. Select the tabs again.');
      const result=await database.seek(operation.time);
      if (result.gap || !result.time) throw new Error('Older history was cleared. Choose an available moment.');
      const plan=planHistoryRestore(result.state,operation.keys,await liveTabs());
      if(operation.targetWindowId!=null && plan.tabs.length)await regularWindow(operation.targetWindowId);
      operation.total=plan.tabs.length;operation.skipped=plan.skipped.length;operation.windowCount=operation.targetWindowId==null?plan.windowCount:0;
      operation.needsConfirmation=plan.tabs.length>50;
      if (operation.needsConfirmation && !confirmed) {await save(operation);return operation;}
      operation.status='running';operation.keys=[];operation.startedAt=clock();
      await save(operation);active=operation;changed();
      void perform(operation,plan,result.state);
      return structuredClone(operation);
    } finally {initializing=null;}
  }

  async function remember(operation, tab, saved, windowId) {
    const owned={id:tab.id,windowId,url:tab.url && historyUrl(tab.url) ? tab.url : saved.url,
      pinned:!!tab.pinned,changed:false,loading:tab.status!=='complete',setting:true};
    operation.created.push(owned);
    // Persist ownership immediately; later failures leave this entry available to Undo.
    try {
      await save(operation);
      if (saved.pinned) { const updated=await api.tabs.update(tab.id,{pinned:true});owned.pinned=updated?.pinned ?? true; }
    }
    finally { delete owned.setting; }
    return owned;
  }
  async function perform(operation,plan,state) {
    try {
      const windows = new Map();
      for(const tab of plan.tabs){if(!windows.has(tab.windowKey))windows.set(tab.windowKey,[]);windows.get(tab.windowKey).push(tab);}
      // Sequential creation preserves order and stays below the concurrency ceiling of four.
      for(const tabs of windows.values()){
        if(operation.stopRequested)break;
        let windowId=operation.targetWindowId ?? null;const pairs=[];
        for(const saved of tabs){
          if(operation.stopRequested)break;
          try{
            // The user can open a page while a long restore is still running.
            if((await liveTabs()).some(tab=>tab.url===saved.url)){
              operation.skipped++;
            }else{
            let tab;
            if(windowId==null){
              const window=await api.windows.create({url:saved.url,focused:false});windowId=window.id;
              tab=window.tabs?.[0] || (await api.tabs.query({windowId}))[0];
            }else tab=await api.tabs.create({windowId,url:saved.url,active:false});
            if(!tab?.id){operation.incompleteUndo=true;throw new Error('The created tab could not be identified.');}
            const owned=await remember(operation,tab,saved,windowId);pairs.push({saved,owned});
            }
          }catch(error){
            operation.failed++;
            if(error.code==='BUDGET'||error.code==='OPERATION_BUDGET'||error.name==='QuotaExceededError'){
              operation.stopRequested=true;operation.incompleteUndo=true;
            }
            try{await save(operation);}catch{operation.stopRequested=true;operation.incompleteUndo=true;}
          }
          operation.completed++;try{await save(operation);}catch{operation.stopRequested=true;operation.incompleteUndo=true;}changed();
        }
        const groups=new Map();
        for(const pair of pairs){if(!pair.saved.groupKey||pair.saved.pinned)continue;
          if(!groups.has(pair.saved.groupKey))groups.set(pair.saved.groupKey,[]);groups.get(pair.saved.groupKey).push(pair.owned.id);}
        for(const [key,tabIds] of groups){
          if(operation.stopRequested)break;
          const setting=pairs.filter(pair=>tabIds.includes(pair.owned.id)).map(pair=>pair.owned);
          for(const owned of setting)owned.setting=true;
          try{const groupId=await api.tabs.group({tabIds});const group=state.groups[key];
            if(group)await api.tabGroups.update(groupId,{title:group.title,color:group.color,collapsed:group.collapsed});
          }catch{operation.groupFailures++;}
          finally{for(const owned of setting)delete owned.setting;}
        }
      }
      operation.status=operation.stopRequested?'stopped':'complete';
    }catch{operation.status='interrupted';operation.incompleteUndo=true;}
    finally{
      try{await save(operation);}catch{operation.status='interrupted';operation.incompleteUndo=true;}
      lastOutcome=structuredClone(operation);active=null;changed();
    }
  }

  async function stop(id) {
    if(active?.id===id){active.stopRequested=true;await save(active);changed();return structuredClone(active);}
    return await database.operation(id);
  }
  async function undo(id) {
    if(active || initializing || undoing)throw new Error('Wait for the current restore or Undo to finish.');
    undoing=id;
    try { return await undoOperation(id); } finally { undoing=null;undoState=null; }
  }
  async function undoOperation(id) {
    // Flush earlier observations before inspecting ownership.
    await serialize(async()=>{});
    const operation=await database.operation(id);
    if(!operation || operation.status==='undone' || operation.status==='planned')return {closed:0,left:0};
    if(operation.epoch!==getEpoch())return {closed:0,left:operation.created.length,expired:true};
    if(await unsafeUndo(id))return {closed:0,left:operation.created.filter(tab=>!tab.undone).length,incomplete:true,unsafe:true};
    if(lastOutcome?.id===id && lastOutcome.incompleteUndo)operation.incompleteUndo=true;
    undoState=operation;
    let closed=0,left=0,failed=0;
    for(const owned of operation.created){
      if(owned.undone)continue;
      let live;
      try { live=await api.tabs.get(owned.id); }
      catch { live=(await liveTabs()).find(tab=>tab.id===owned.id); }
      if(unsafeId===id)return {closed,left:operation.created.filter(tab=>!tab.undone).length,failed,incomplete:true,unsafe:true};
      if(!live){owned.undone=true;}
      else if(canUndoHistoryTab(owned,live)){
        try {await api.tabs.remove(owned.id);closed++;owned.undone=true;}
        catch {failed++;}
      }else {left++;owned.undone=true;}
      await save(operation);
    }
    operation.status=failed?'partial-undo':'undone';await save(operation);changed();return {closed,left,failed,incomplete:!!operation.incompleteUndo};
  }
  async function openTab(time, key) {
    const result=await database.seek(time),tab=result.state.tabs[key];
    if(result.gap || !tab || tab.detached || !historyUrl(tab.url))throw new Error('This tab is unavailable. Choose another recorded moment.');
    const existing=(await liveTabs()).find(t=>t.url===tab.url);
    if(existing){await api.windows.update(existing.windowId,{focused:true});await api.tabs.update(existing.id,{active:true});return {existing:true,id:existing.id};}
    const window=await api.windows.getLastFocused({windowTypes:['normal']});
    if(window?.incognito)throw new Error('Open Tab Atlas in a regular window to restore this page.');
    const created=await api.tabs.create({windowId:window.id,url:tab.url,active:true});return {existing:false,id:created.id};
  }

  function observe(type, id, info={}, tab={}) {
    const operation=active || undoState;
    if(!operation)return;
    const owned=operation.created.find(t=>t.id===id&&!t.undone);
    if(!owned)return;
    if(type==='updated'){
      if(info.url){
        if(owned.loading&&!owned.changed)owned.url=info.url;
        else if(info.url!==owned.url)owned.changed=true;
      }
      if(Object.hasOwn(info,'pinned')&&!owned.setting&&!!info.pinned!==owned.pinned)owned.changed=true;
      if(info.status==='complete')owned.loading=false;
    }
    if(['moved','attached','activated'].includes(type)&&!owned.setting)owned.changed=true;
    if(tab.incognito)owned.changed=true;
    updated(operation);
  }
  // Closed/completed operations must also learn user edits and initial redirects.
  async function observeStored(type,id,info={},tab={}) {
    if(active || undoState){observe(type,id,info,tab);return;}
    await serialize(async()=>{
    const operation=(await database.status()).lastRestore;
    if(!operation || operation.epoch!==getEpoch() || ['planned','undone'].includes(operation.status))return;
    const owned=operation.created.find(t=>t.id===id&&!t.undone);if(!owned)return;
    if(type==='updated'){
      if(info.url){if(owned.loading&&!owned.changed)owned.url=info.url;else if(info.url!==owned.url)owned.changed=true;}
      if(Object.hasOwn(info,'pinned')&&!!info.pinned!==owned.pinned)owned.changed=true;
      if(info.status==='complete')owned.loading=false;
    }else if(['moved','attached','activated'].includes(type))owned.changed=true;
    if(tab.incognito)owned.changed=true;
    try{await database.putOperation(operation);}catch(error){await protectUndo(operation.id);throw error;}
    });
  }

  return {prepare,start,stop,undo,openTab,recover,observeStored,statusOperation, operationId:()=>active?.id || initializing || undoing};
}
