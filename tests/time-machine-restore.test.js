import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeMachineRestorer } from '../extension/lib/time-machine-restore.js';
import { captureHistoryState } from '../extension/lib/time-machine-model.js';

function fixture(count=3) {
  const tabs=new Map(),operations=new Map(),calls=[];let nextTab=100,nextWindow=10;
  let epoch='epoch-1',removeFailure=false;
  const historical=Array.from({length:count},(_,i)=>({id:i+1,windowId:1,index:i,url:`https://example.test/${i}`,title:`Page ${i}`,pinned:i===0,groupId:i>0?4:-1}));
  const state=captureHistoryState([{id:1,type:'normal',tabs:historical}],[{id:4,windowId:1,title:'Research',color:'blue'}]);
  const db={async seek(){return {state:structuredClone(state),time:1000,gap:false};},
    async status(){return {lastRestore:structuredClone([...operations.values()].filter(o=>o.status!=='planned').at(-1) || null)};},
    async operation(id){return structuredClone(operations.get(id) || null);},
    async putOperation(op){operations.set(op.id,structuredClone(op));}};
  const api={windows:{async getAll(){return [...new Set([...tabs.values()].map(t=>t.windowId))].map(id=>({id,type:'normal',tabs:[...tabs.values()].filter(t=>t.windowId===id)}));},
    async create(opts){const id=++nextWindow;const tab={id:++nextTab,windowId:id,url:opts.url,pinned:false,status:'complete'};tabs.set(tab.id,tab);calls.push(['window',opts]);return {id,tabs:[{...tab}]};},
    async update(id,v){calls.push(['focus',id,v]);},async get(id){return {id,type:'normal'};},async getLastFocused(){return {id:1,type:'normal'};}},
    tabs:{async create(opts){const tab={id:++nextTab,windowId:opts.windowId,url:opts.url,pinned:false,status:'complete'};tabs.set(tab.id,tab);calls.push(['tab',opts]);return {...tab};},
      async update(id,values){Object.assign(tabs.get(id),values);return {...tabs.get(id)};},async get(id){if(!tabs.has(id))throw new Error('gone');return {...tabs.get(id)};},
      async query({windowId}){return [...tabs.values()].filter(t=>t.windowId===windowId);},
      async remove(id){if(removeFailure)throw new Error('temporary failure');calls.push(['remove',id]);tabs.delete(id);},async group(opts){calls.push(['group',opts]);return 9;}},
    tabGroups:{async update(id,values){calls.push(['group-settings',id,values]);}}};
  const restorer=createTimeMachineRestorer(api,db,{getEpoch:()=>epoch});
  const prepare=()=>restorer.prepare(1000,Object.keys(state.tabs));
  const settle=async id=>{for(let i=0;i<100;i++){await new Promise(r=>setImmediate(r));const op=operations.get(id);if(op&&op.status!=='running')return op;}throw new Error('Restore did not settle');};
  return {restorer,tabs,operations,calls,prepare,settle,state,db,api,setEpoch:value=>{epoch=value;},setRemoveFailure:value=>{removeFailure=value;}};
}

test('prepare is read-only for browser, restore preserves pinned/grouped tabs, duplicate requests do not reopen',async()=>{
  const f=fixture(),op=await f.prepare();assert.equal(f.calls.length,0);
  await f.restorer.start(op.id);const done=await f.settle(op.id);
  assert.equal(done.status,'complete');assert.equal(done.created.length,3);
  assert.equal(f.calls.filter(c=>c[0]==='window').length,1);
  assert.equal([...f.tabs.values()].filter(t=>t.pinned).length,1);
  assert.ok(f.calls.some(c=>c[0]==='group-settings'&&c[2].title==='Research'));
  await f.restorer.start(op.id);assert.equal(f.tabs.size,3);
  await assert.rejects(f.restorer.start('expired-request'),/expired/);
});

test('already-open exact URLs are skipped, producing no empty windows',async()=>{
  const f=fixture(1);f.tabs.set(5,{id:5,windowId:1,url:'https://example.test/0',pinned:false});
  const op=await f.prepare();assert.equal(op.total,0);assert.equal(op.skipped,1);
  await f.restorer.start(op.id);await f.settle(op.id);assert.equal(f.calls.length,0);
  assert.deepEqual(await f.restorer.undo(op.id),{closed:0,left:0,failed:0,incomplete:false});
});

test('one selected tab opens in the dashboard window and Undo preserves its existing tabs',async()=>{
  const f=fixture(1);
  f.tabs.set(7,{id:7,windowId:5,url:'https://unrelated.test/',pinned:false});
  f.api.windows.get=async id=>({id,type:'normal',incognito:false});
  const op=await f.restorer.prepare(1000,Object.keys(f.state.tabs),5);
  assert.equal(op.windowCount,0);
  await f.restorer.start(op.id);const done=await f.settle(op.id);
  assert.equal(done.created.length,1);assert.equal(done.created[0].windowId,5);
  assert.equal(f.calls.filter(call=>call[0]==='window').length,0);
  assert.equal(f.tabs.get(done.created[0].id).pinned,true);
  assert.equal(f.calls.find(call=>call[0]==='tab')[1].active,false);
  assert.equal((await f.restorer.undo(op.id)).closed,1);
  assert.deepEqual([...f.tabs.keys()],[7]);
  await f.restorer.start(op.id);assert.deepEqual([...f.tabs.keys()],[7]);
});

test('one selected grouped tab preserves group metadata in the current window',async()=>{
  const f=fixture(2),key=Object.values(f.state.tabs).find(tab=>!tab.pinned).key;
  const op=await f.restorer.prepare(1000,[key]);await f.restorer.start(op.id);const done=await f.settle(op.id);
  assert.equal(done.created[0].windowId,1);
  assert.ok(f.calls.some(call=>call[0]==='group-settings'&&call[2].title==='Research'));
  assert.equal(f.calls.filter(call=>call[0]==='window').length,0);
});

test('one selected restore refuses a private or closed destination without opening another window',async()=>{
  for(const destination of [{id:5,type:'normal',incognito:true},undefined]){
    const f=fixture(1);f.api.windows.get=async()=>destination;
    await assert.rejects(f.restorer.prepare(1000,Object.keys(f.state.tabs),5),/regular window/);
    assert.equal(f.calls.length,0);assert.equal(f.operations.size,0);
  }
  const f=fixture(1);f.api.windows.get=async id=>({id,type:'normal'});
  const op=await f.restorer.prepare(1000,Object.keys(f.state.tabs),5);
  f.api.windows.get=async()=>{throw new Error('Window closed');};
  await assert.rejects(f.restorer.start(op.id),/regular window/);
  assert.equal(f.calls.length,0);
});

test('a multiple selection still uses new windows when duplicates leave only one missing tab',async()=>{
  const f=fixture(2);f.tabs.set(7,{id:7,windowId:1,url:'https://example.test/0',pinned:false});
  const op=await f.prepare();assert.equal(op.total,1);assert.equal(op.windowCount,1);
  await f.restorer.start(op.id);await f.settle(op.id);
  assert.equal(f.calls.filter(call=>call[0]==='window').length,1);
});

test('more than 50 tabs require confirmation before creating any browser windows',async()=>{
  const f=fixture(51),op=await f.prepare();assert.equal(op.needsConfirmation,true);
  const unconfirmed=await f.restorer.start(op.id);assert.equal(unconfirmed.status,'planned');assert.equal(f.calls.length,0);
  await f.restorer.start(op.id,true);await f.settle(op.id);assert.equal(f.tabs.size,51);
});

test('Undo leaves moved, navigated and repinned tabs as well as unrelated tabs untouched',async()=>{
  const f=fixture(4),op=await f.prepare();await f.restorer.start(op.id);const done=await f.settle(op.id);
  const [a,b,c]=done.created;f.tabs.get(a.id).windowId=777;f.tabs.get(b.id).url='https://else.test/';f.tabs.get(c.id).pinned=true;
  f.tabs.set(6,{id:6,windowId:1,url:'https://unrelated.test/',pinned:false});
  const undo=await f.restorer.undo(op.id);assert.equal(undo.closed,1);assert.equal(undo.left,3);assert.equal(f.tabs.size,4);
  assert.ok(f.tabs.has(6));await f.restorer.undo(op.id);assert.equal(f.tabs.size,4);
});

test('Undo refuses ownership from an earlier browser epoch even when Chrome IDs match',async()=>{
  const f=fixture(),op=await f.prepare();await f.restorer.start(op.id);await f.settle(op.id);f.setEpoch('epoch-2');
  const result=await f.restorer.undo(op.id);assert.equal(result.expired,true);assert.equal(f.tabs.size,3);
});

test('failed removals remain eligible for a later Undo retry',async()=>{
  const f=fixture(1),op=await f.prepare();await f.restorer.start(op.id);await f.settle(op.id);f.setRemoveFailure(true);
  const result=await f.restorer.undo(op.id);assert.equal(result.failed,1);assert.equal(f.operations.get(op.id).status,'partial-undo');
  f.setRemoveFailure(false);assert.equal((await f.restorer.undo(op.id)).closed,1);assert.equal(f.tabs.size,0);
});

test('single-page opening focuses existing exact URL and never claims it as new restore ownership',async()=>{
  const f=fixture(1),key=Object.keys(f.state.tabs)[0];f.tabs.set(7,{id:7,windowId:1,url:'https://example.test/0'});
  const result=await f.restorer.openTab(1000,key);assert.equal(result.existing,true);assert.equal(f.tabs.size,1);assert.equal(f.operations.size,0);
});

test('interrupted worker recovery preserves known created IDs without automatically continuing restore',async()=>{
  const f=fixture();f.operations.set('old',{id:'old',epoch:'epoch-1',status:'running',startedAt:10,created:[{id:15,windowId:2,url:'https://example.test/',pinned:false}]});
  await f.restorer.recover();assert.equal(f.operations.get('old').status,'interrupted');assert.equal(f.calls.length,0);
});

test('user move followed by a redirect cannot overwrite the changed ownership flag',async()=>{
  const f=fixture(1),op=await f.prepare();await f.restorer.start(op.id);const done=await f.settle(op.id);
  f.operations.get(op.id).created[0].loading=true;
  const owned=done.created[0];
  await Promise.all([f.restorer.observeStored('moved',owned.id),f.restorer.observeStored('updated',owned.id,{url:'https://redirect.test/'})]);
  assert.equal(f.operations.get(op.id).created[0].changed,true);
  assert.equal((await f.restorer.undo(op.id)).left,1);
});

test('pin setup failure counts once and still allows Undo of the unchanged created tab',async()=>{
  const f=fixture(1);f.restorer=createTimeMachineRestorer({
    windows:{getAll:async()=>[],getLastFocused:async()=>({id:3,type:'normal'}),get:async()=>({id:3,type:'normal'})},
    tabs:{create:async()=>{const tab={id:99,windowId:3,url:'https://example.test/0',pinned:false,status:'complete'};f.tabs.set(99,tab);return tab;},update:async()=>{throw new Error('Pin failed');},get:async id=>f.tabs.get(id),remove:async id=>f.tabs.delete(id)},
  },f.db,{getEpoch:()=> 'epoch-1'});
  const op=await f.restorer.prepare(1000,Object.keys(f.state.tabs));await f.restorer.start(op.id);const done=await f.settle(op.id);
  assert.equal(done.completed,1);assert.equal(done.failed,1);assert.equal(done.created.length,1);
  assert.equal(done.created[0].setting,undefined);assert.equal((await f.restorer.undo(op.id)).closed,1);
});

test('concurrent Undo requests cannot perform removals twice',async()=>{
  const f=fixture(2),op=await f.prepare();await f.restorer.start(op.id);await f.settle(op.id);
  const results=await Promise.allSettled([f.restorer.undo(op.id),f.restorer.undo(op.id)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='remove').length,2);
});

test('a same-window move observed during Undo is not erased by a stale operation save',async()=>{
  const f=fixture(1),op=await f.prepare();await f.restorer.start(op.id);await f.settle(op.id);
  const original=f.api.tabs.get;
  f.api.tabs.get=async id=>{const tab=await original(id);await f.restorer.observeStored('moved',id);return tab;};
  const result=await f.restorer.undo(op.id);assert.equal(result.closed,0);assert.equal(result.left,1);
  assert.equal(f.tabs.size,1);assert.equal(f.operations.get(op.id).created[0].changed,true);
});

test('pages opened by the user during a restore are skipped before creation',async()=>{
  const f=fixture(3),original=f.api.windows.create;
  f.api.windows.create=async options=>{
    const result=await original(options);
    f.tabs.set(7,{id:7,windowId:1,url:'https://example.test/1',pinned:false});
    return result;
  };
  const op=await f.prepare();await f.restorer.start(op.id);const done=await f.settle(op.id);
  assert.equal(done.created.length,2);assert.equal(done.skipped,1);assert.equal(done.completed,3);
  assert.equal((await f.restorer.undo(op.id)).closed,2);assert.ok(f.tabs.has(7));
});

test('Stop ends future creation and preserves Undo for the in-flight created tab',async()=>{
  const f=fixture(8),original=f.api.windows.create;let requestId;
  f.api.windows.create=async options=>{
    const window=await original(options);await f.restorer.stop(requestId);return window;
  };
  const op=await f.prepare();requestId=op.id;await f.restorer.start(op.id);const done=await f.settle(op.id);
  assert.equal(done.status,'stopped');assert.equal(done.created.length,1);assert.equal(done.completed,1);
  assert.equal(f.calls.filter(c=>c[0]==='tab').length,0);assert.equal((await f.restorer.undo(op.id)).closed,1);
});

test('failed final persistence exposes an interrupted result while retaining Undo for durable ownership',async()=>{
  const f=fixture(3),put=f.db.putOperation;
  f.db.putOperation=async operation=>{if(operation.status==='complete')throw new Error('Final write failed');await put(operation);};
  const op=await f.prepare();await f.restorer.start(op.id);
  for(let i=0;i<100&&f.restorer.operationId();i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.restorer.operationId(),null);
  const persisted=(await f.db.status()).lastRestore;assert.equal(persisted.status,'running');
  const shown=await f.restorer.statusOperation(persisted);
  assert.equal(shown.status,'interrupted');assert.equal(shown.incompleteUndo,true);assert.equal(shown.undoableCount,3);
  const undone=await f.restorer.undo(op.id);assert.equal(undone.closed,3);assert.equal(undone.incomplete,true);
});

test('restore stays running until the final ownership write commits, before exposing Undo',async()=>{
  const f=fixture(1),put=f.db.putOperation;
  let beginFinal,releaseFinal;
  const began=new Promise(resolve=>{beginFinal=resolve;}),gate=new Promise(resolve=>{releaseFinal=resolve;});
  f.db.putOperation=async operation=>{if(operation.status==='complete'){beginFinal();await gate;}await put(operation);};
  const op=await f.prepare();await f.restorer.start(op.id);await began;
  try{
    const shown=await f.restorer.statusOperation((await f.db.status()).lastRestore);
    assert.equal(shown.status,'running');
    assert.equal((await f.restorer.start(op.id)).status,'running');
    assert.equal(f.tabs.size,1);
  }finally{releaseFinal();}
  for(let i=0;i<100&&f.restorer.operationId();i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.restorer.statusOperation((await f.db.status()).lastRestore)).status,'complete');
  assert.equal((await f.restorer.undo(op.id)).closed,1);
});

test('interrupted recovery remains readable when its status cannot be written',async()=>{
  const f=fixture();f.operations.set('old',{id:'old',epoch:'epoch-1',status:'running',created:[],startedAt:10});
  f.db.putOperation=async()=>{throw new Error('Storage unavailable');};
  await f.restorer.recover();const shown=await f.restorer.statusOperation((await f.db.status()).lastRestore);
  assert.equal(shown.status,'interrupted');assert.equal(shown.incompleteUndo,true);assert.equal(shown.undoableCount,0);
  assert.equal(f.calls.length,0);
});

test('an unpersisted user edit disables unsafe Undo across worker recreation using a bounded session guard',async()=>{
  const f=fixture(2),guard={};f.api.storage={session:{async get(key){return {[key]:guard[key]};},async set(values){Object.assign(guard,values);}}};
  const op=await f.prepare();await f.restorer.start(op.id);const done=await f.settle(op.id);
  f.db.putOperation=async()=>{throw new Error('History write failed');};
  await assert.rejects(f.restorer.observeStored('moved',done.created[0].id),/History write failed/);
  const restarted=createTimeMachineRestorer(f.api,f.db,{getEpoch:()=> 'epoch-1'});await restarted.recover();
  const shown=await restarted.statusOperation((await f.db.status()).lastRestore);
  assert.equal(shown.unsafeUndo,true);assert.equal(shown.undoableCount,0);
  assert.equal((await restarted.undo(op.id)).unsafe,true);assert.equal(f.tabs.size,2);
  assert.equal(f.calls.filter(call=>call[0]==='remove').length,0);
  assert.equal(JSON.stringify(guard).includes('https:'),false);
});
