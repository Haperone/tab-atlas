import { createTimeMachineDatabase } from '../extension/lib/time-machine-db.js';
import { captureHistoryState, reduceChromeHistory, TIME_MACHINE_LIMITS } from '../extension/lib/time-machine-model.js';
import { checkNativeWorker } from './time-machine-worker-checks.js';
import { createQuotaFaultFactory } from './time-machine-quota-fixture.js';

const output = document.getElementById('results'), run = document.getElementById('run');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item);
const request = value => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
const sample = (count, suffix = '') => captureHistoryState([{ id: 1, type: 'normal', tabs: Array.from({ length: count }, (_, i) => ({
  id: i + 1, windowId: 1, index: i, active: i === 0, url: `https://example.test/${i}${suffix}`, title: `Page ${i} — статья 🌙`,
})) }], []);

run.addEventListener('click', async () => {
  run.disabled = true; const results = [];
  async function check(name, body, options = {}) {
    const databaseName = `tab-atlas-time-machine-test-${crypto.randomUUID()}`;
    const db = createTimeMachineDatabase({ name: databaseName, ...options });
    const started = performance.now();
    try { const evidence = await body(db, databaseName); results.push({ name, passed: true, ms: performance.now() - started, evidence }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
    finally { db.close(); await request(indexedDB.deleteDatabase(databaseName)); }
    output.textContent = JSON.stringify({ running: true, results }, null, 2);
  }
  await check('Opt-in and empty database', async db => {
    const status = await db.status(); assert(!status.enabled && !status.oldest, 'New database recorded data without opt-in');
    await db.configure({ enabled: true }); assert((await db.status()).enabled, 'Enable setting was lost');
  });
  await check('Replay, dictionary and exact byte ledger', async db => {
    let state = sample(3); const start = Date.now();
    await db.append(state, { boundary: true, kind: 'enabled', wallTime: start });
    const firstKey = Object.keys(state.tabs)[0];
    state = reduceChromeHistory(state, { type: 'removed', id: 1 });
    await db.append(state, { wallTime: start + 10 });
    assert(Object.keys((await db.seek(start)).state.tabs).length === 3, 'Past state lost closed tab');
    assert(!((await db.seek(start + 10)).state.tabs[firstKey]), 'Closed tab remained in later state');
    const audit = await db.audit(); assert(audit.measured === audit.recorded, `Ledger differs: ${audit.measured}/${audit.recorded}`);
    assert(audit.missing.length === 0, 'Dictionary references are missing');
    return audit;
  });
  await check('Pause boundary is a genuine gap', async db => {
    const start = Date.now(); await db.append(sample(2), { boundary:true, wallTime:start });
    await db.configure({ paused:true });
    await db.append(sample(1), { boundary:true, kind:'resumed', wallTime:start+100 });
    assert((await db.seek(start+50)).gap, 'Pause was shown as recorded state');
    assert(!(await db.seek(start+100)).gap, 'Resume did not create independent checkpoint');
  });
  await check('Gap navigation reaches adjacent events, including a gap after the first baseline',async db=>{
    const start=Date.now(),state=sample(1);await db.append(state,{boundary:true,wallTime:start});
    await db.configure({paused:true});await db.append(sample(2),{boundary:true,wallTime:start+100});
    assert((await db.seek(start+50)).gap,'The first gap was not represented');
    assert(await db.step(null,-1,start+50)===start,'Earlier skipped the initial baseline');
    assert(await db.step(null,1,start+50)===start+100,'Later skipped the resumed baseline');
    const key=Object.keys(state.tabs)[0];state.tabs[key].title='Changed after checkpoint';
    await db.append(state,{wallTime:start+110});state.tabs[key].title='Last before pause';await db.append(state,{wallTime:start+120});
    await db.configure({paused:true});await db.append(sample(3),{boundary:true,wallTime:start+200});
    assert((await db.seek(start+150)).gap,'The second gap was not represented');
    assert(await db.step(null,-1,start+150)===start+120,'Earlier skipped changes after the checkpoint');
    assert(await db.step(null,1,start+150)===start+200,'Later entered the preceding segment');
  });
  await check('No-op writes and restart preserve durable current state', async (db, name) => {
    const state = sample(10); await db.append(state, { boundary:true });
    const first = await db.status(); await db.append(state);
    assert((await db.status()).latestSeq === first.latestSeq, 'No-op added an event');
    db.close(); assert(canonical(await db.current()) === canonical(state), 'Restart lost state');
    const sameDatabase = createTimeMachineDatabase({ name });
    assert((await sameDatabase.status()).latestSeq === first.latestSeq, 'Second connection lost journal'); sameDatabase.close();
  });
  await check('Failed oversized write aborts dictionary, event and metadata together', async db => {
    const start = Date.now(); await db.append(sample(2), { boundary:true, wallTime:start });
    const before = await db.audit(); const seq = (await db.status()).latestSeq;
    let failed = false;
    try { await db.append(sample(1, `?long=${'x'.repeat(30000)}`), { wallTime:start+1 }); } catch (error) { failed = error.code === 'BUDGET'; }
    assert(failed, 'Oversized write succeeded'); const after = await db.audit();
    assert(after.measured === before.measured && (await db.status()).latestSeq === seq, 'Aborted write changed database');
    assert((await db.current()).tabs[Object.keys((await db.current()).tabs)[0]].url.length < 100, 'Oversized value leaked into current state');
  }, { limits:{...TIME_MACHINE_LIMITS,budget:12000,trimTo:8000,operationReserve:1000} });
  await check('Rolling budget retains replay anchors and collects unreachable strings', async db => {
    const start = Date.now(); let state = sample(3);
    await db.append(state, { boundary:true,wallTime:start });
    for (let i=1;i<=60;i++) {
      const key=Object.keys(state.tabs)[0]; state=structuredClone(state);
      state.tabs[key].url=`https://example.test/history-${i}?data=${'q'.repeat(200)}`;
      await db.append(state,{wallTime:start+i});
    }
    const status=await db.status(),audit=await db.audit();
    assert(status.bytes<=12000,'Budget exceeded'); assert(status.oldest>start,'Old history never cleared');
    assert(!audit.missing.length&&!audit.unreachable.length,'Dictionary GC lost references or retained dead strings');
    assert(audit.measured===audit.recorded,'Compaction corrupted ledger');
    const final=await db.seek(status.latest); assert(canonical(final.state)===canonical(state),'Newest state changed during compaction');
    for(let seqTime=status.oldest;seqTime<=status.latest;seqTime++) assert(!(await db.seek(seqTime)).gap,'Retained interval lost replay anchor');
    return {status,audit};
  },{limits:{...TIME_MACHINE_LIMITS,budget:12000,trimTo:8000,operationReserve:1000,checkpointEvents:5}});
  await check('Operation records share the budget and survive reopening', async db => {
    await db.append(sample(3),{boundary:true});
    await db.putOperation({id:'restore-1',status:'complete',created:[{id:30,url:'https://example.test/30',windowId:2,pinned:false}]});
    db.close(); assert((await db.operation('restore-1')).created.length===1,'Restore ownership was not durable');
    await db.putOperation({id:'restore-2',status:'complete',created:[]});
    assert(!(await db.operation('restore-1')),'Old restore record was not pruned');
    const audit=await db.audit();assert(audit.measured===audit.recorded,'Operation ledger differs');
  });
  await check('Clock rollback creates a separate segment without reversing sequence', async db => {
    const start=Date.now();await db.append(sample(1),{boundary:true,wallTime:start});
    await db.append(sample(2),{wallTime:start-1000});
    const status=await db.status();assert(status.latest>start&&status.segments.length===2,'Clock rollback corrupted timeline order');
    assert(status.segments.at(-1).reason==='clock-change','Clock change was not disclosed');
    assert((await db.seek(status.latest)).wallTime===start-1000,'Historical date was replaced by logical ordering time');
  });
  await check('Newer schema is preserved instead of reset', async (db,name) => {
    await db.append(sample(1),{boundary:true});db.close();
    const upgraded=await request(indexedDB.open(name,2));upgraded.close();
    let refused=false;try{await db.status();}catch(error){refused=error.code==='VersionError';}
    assert(refused,'Unknown schema was opened for writing');
    const preserved=await request(indexedDB.open(name,2));assert(preserved.objectStoreNames.contains('events'),'Newer database was erased');preserved.close();
  });
  await check('Version change releases connections for upgrade', async (db,name) => {
    await db.append(sample(1),{boundary:true});
    const upgraded=await request(indexedDB.open(name,2));assert(upgraded.version===2,'Existing connection blocked upgrade');upgraded.close();
  });
  await check('Blocked open reports Retry and preserves the existing database',async(db,name)=>{
    await db.append(sample(1),{boundary:true});db.close();
    const blocker=await request(indexedDB.open(name,1));blocker.onversionchange=()=>{};
    const upgrade=indexedDB.open(name,2),upgraded=request(upgrade);
    await new Promise(resolve=>{upgrade.onblocked=resolve;});
    try{
      let busy=false;try{await db.status();}catch(error){busy=error.code==='BLOCKED';}
      assert(busy,'Blocked connection was not disclosed');
    }finally{blocker.close();(await upgraded).close();}
    const preserved=await request(indexedDB.open(name,2));
    assert(await request(preserved.transaction('events').objectStore('events').count())===1,'Blocked open erased the journal');preserved.close();
  });
  await check('Missing dictionary data is disclosed and only explicit Clear removes history',async(db,name)=>{
    await db.append(sample(2),{boundary:true});db.close();
    const native=await request(indexedDB.open(name,1)),tx=native.transaction('strings','readwrite');
    const key=await request(tx.objectStore('strings').getAllKeys());await request(tx.objectStore('strings').delete(key[0]));
    await new Promise(resolve=>{tx.oncomplete=resolve;});native.close();
    let corrupt=false;try{await db.current();}catch(error){corrupt=error.code==='CORRUPT';}
    assert(corrupt&&(await db.status()).latestSeq===1,'Corruption was hidden or silently cleared');
    await db.clear();assert(!(await db.status()).oldest,'Explicit Clear did not recover the database');
  });
  await check('Clear resets history without saved-link storage writes', async db => {
    await db.configure({enabled:true});await db.append(sample(3),{boundary:true});await db.clear();
    const status=await db.status();assert(status.enabled&&!status.oldest,'Clear changed opt-in or retained history');
    assert(Object.keys((await db.current()).tabs).length===0,'Clear retained current model');
    const audit=await db.audit();assert(audit.measured===audit.recorded,'Cleared ledger differs');
  });
  await check('Native worker restart and interrupted restore across contexts',async()=>await checkNativeWorker(assert));
  const quota=createQuotaFaultFactory(indexedDB);
  await check('Native rollback and exactly one quota retry',async db=>{
    await db.append(sample(2),{boundary:true});quota.arm(1);
    await db.append(sample(3),{});assert(quota.faults.count===1,'Quota recovery did not retry once');
    assert(Object.keys((await db.current()).tabs).length===3,'Quota retry lost the new state');
    quota.arm(2);let refused=false;
    try{await db.append(sample(4),{});}catch(error){refused=error.name==='QuotaExceededError';}
    assert(refused&&quota.faults.count===2,'Quota failure retried indefinitely or was hidden');
    assert(Object.keys((await db.current()).tabs).length===3,'Second failed write leaked into current state');
    quota.arm(0);await db.append(sample(4),{});const audit=await db.audit();
    assert(audit.recorded===audit.measured&&!audit.missing.length,'Rolled-back cached dictionary IDs leaked into recovery');
    return {retryLimit:1,injection:'Quota exception at events.put after native dictionary writes; native IDB abort/rollback'};
  },{indexedDB:quota.factory});
  const operationQuota=createQuotaFaultFactory(indexedDB,'operations');
  await check('Ownership quota recovery retries once and preserves the durable operation',async db=>{
    await db.append(sample(2),{boundary:true});
    const operation={id:'quota-operation',status:'running',startedAt:Date.now(),created:[]};
    await db.putOperation(operation);operationQuota.arm(1);
    operation.created.push({id:42,url:'https://example.test/owned',windowId:1,pinned:false});
    await db.putOperation(operation);
    assert(operationQuota.faults.count===1&&(await db.operation(operation.id)).created.length===1,'Ownership quota recovery lost the result');
    operationQuota.arm(2);operation.status='completed';let refused=false;
    try{await db.putOperation(operation);}catch(error){refused=error.name==='QuotaExceededError';}
    assert(refused&&operationQuota.faults.count===2,'Ownership write exceeded the single retry limit');
    assert((await db.operation(operation.id)).status==='running','Failed operation write escaped rollback');
    operationQuota.arm(0);await db.putOperation(operation);
    const audit=await db.audit();assert(audit.measured===audit.recorded&&!audit.missing.length,'Ownership recovery corrupted the ledger');
    return {retryLimit:1,injection:'Quota exception at operations.put; native IDB rollback'};
  },{indexedDB:operationQuota.factory});
  await check('Age maintenance expires paused history and preserves the ledger',async db=>{
    await db.configure({enabled:true,paused:true});await db.append(sample(2),{boundary:true,wallTime:Date.now()-5000});
    await db.maintain();const status=await db.status(),audit=await db.audit();
    assert(!status.oldest&&status.enabled&&status.paused,'Expired history or opt-in was mishandled');
    assert(audit.recorded===audit.measured&&!audit.totals.strings.count,'Expired dictionary or ledger remained');
  },{limits:{...TIME_MACHINE_LIMITS,maxAge:1000}});
  await check('Replay timing with 199 events between checkpoints: 1000 tabs',async db=>{
    const state=sample(1000),startTime=Date.now(),key=Object.keys(state.tabs)[0];
    await db.append(state,{boundary:true,wallTime:startTime});
    const writeStart=performance.now();
    for(let i=1;i<200;i++){state.tabs[key].title=`Historical title ${i}`;await db.append(state,{wallTime:startTime+i});}
    const writeMs=performance.now()-writeStart,status=await db.status(),seeks=[];
    for(let i=0;i<20;i++){const start=performance.now(),value=await db.seek(status.latest);seeks.push(performance.now()-start);assert(value.state.tabs[key].title==='Historical title 199','Replay lost final event');}
    seeks.sort((a,b)=>a-b);assert(seeks[18]<=250,'1000-tab p95 seek exceeded 250ms');
    return {events:200,writeMs,p95SeekMs:seeks[18],bytes:status.bytes};
  });
  await check('Checkpoints bound replay by 200 events or five minutes on the next event',async db=>{
    const state=sample(1),start=Date.now(),key=Object.keys(state.tabs)[0];await db.append(state,{boundary:true,wallTime:start});
    for(let i=1;i<=200;i++){state.tabs[key].title=`Change ${i}`;await db.append(state,{wallTime:start+i});}
    assert((await db.audit()).totals.checkpoints.count===2,'Two hundred events did not create a checkpoint');
    state.tabs[key].title='After five minutes';await db.append(state,{wallTime:start+300201});
    assert((await db.audit()).totals.checkpoints.count===3,'Next event after five minutes did not create a checkpoint');
    assert((await db.seek((await db.status()).latest)).state.tabs[key].title==='After five minutes','Checkpoint lost the final state');
  });
  for(const count of [100,1000,10000])await check(`Storage timings: ${count} synthetic tabs`,async db=>{
    const state=sample(count),writeStart=performance.now();await db.append(state,{boundary:true});
    const writeMs=performance.now()-writeStart,status=await db.status(),seeks=[];
    for(let i=0;i<20;i++){const start=performance.now();const result=await db.seek(status.latest);seeks.push(performance.now()-start);assert(Object.keys(result.state.tabs).length===count,'Large state lost tabs');}
    const audit=await db.audit();assert(audit.measured===audit.recorded&&!audit.missing.length,'Large ledger invalid');
    seeks.sort((a,b)=>a-b);return {count,writeMs,p95SeekMs:seeks[18],bytes:status.bytes};
  });
  await check('Near-budget history: initial status and seek timing',async db=>{
    const startTime=Date.now();let high=0,writeMs=0,trimMs=0,measured=null;
    for(let i=0;i<18;i++){
      const started=performance.now();await db.append(sample(1000,`?version=${i}&payload=${'x'.repeat(1000)}`),{boundary:i===0,wallTime:startTime+i});
      const ms=performance.now()-started,status=await db.status();writeMs+=ms;if(status.bytes<high)trimMs=ms;high=Math.max(high,status.bytes);
      if(!measured && status.bytes>=19*1024*1024){
        const samples=[];for(let j=0;j<20;j++){const began=performance.now(),s=await db.status();await db.seek(s.latest);samples.push(performance.now()-began);}
        samples.sort((a,b)=>a-b);measured={bytesAtMeasurement:status.bytes,p95FirstUsefulMs:samples[18],originEstimate:await navigator.storage?.estimate()};
      }
    }
    const status=await db.status(),times=[];
    for(let i=0;i<20;i++){const start=performance.now();const status=await db.status();await db.seek(status.latest);times.push(performance.now()-start);}
    times.sort((a,b)=>a-b);assert(measured?.p95FirstUsefulMs<=1000,'Near-budget first useful result exceeded 1s p95');
    const estimate=await navigator.storage?.estimate(),audit=await db.audit();
    assert(status.bytes<=TIME_MACHINE_LIMITS.budget&&audit.recorded===audit.measured,'Near-budget ledger failed');
    assert(!audit.missing.length&&!audit.unreachable.length,'Compaction left unreachable dictionary entries');
    return {count:1000,events:18,bytes:status.bytes,highestBytes:high,writeMs,trimMs,...measured,postTrimP95Ms:times[18],postTrimOriginEstimate:estimate,
      note:'Origin estimate includes other origin data and IndexedDB overhead; it is not this database size'};
  });
  output.textContent=JSON.stringify({running:false,passed:results.every(r=>r.passed),results},null,2);run.disabled=false;
});
