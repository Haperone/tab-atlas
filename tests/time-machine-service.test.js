import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeMachineService, TIME_MACHINE_PREFIX } from '../extension/lib/time-machine-service.js';
import { emptyHistoryState } from '../extension/lib/time-machine-model.js';

function fixture() {
  let serial=0;
  const store={},session={},events=[],handlers={};
  const event = name => ({addListener(fn){(handlers[name] ||= []).push(fn);}});
  const tab = (id,extra={})=>({id,windowId:1,url:`https://example.test/${id}`,title:`Page ${id}`,index:id-1,...extra});
  const windows=[{id:1,type:'normal',tabs:[tab(1)]}];
  const api={runtime:{id:'test',getURL:p=>`chrome-extension://test/${p}`,onStartup:event('startup')},
    storage:{local:{async get(k){return {[k]:store[k]};},async set(v){Object.assign(store,v);}},
      session:{async get(k){return {[k]:session[k]};},async set(v){Object.assign(session,v);}}},
    windows:{async getAll(){return structuredClone(windows);},async get(id){return structuredClone(windows.find(w=>w.id===id));},onCreated:event('window-created'),onRemoved:event('window-removed')},
    tabs:{async get(id){const value=windows.flatMap(w=>w.tabs).find(t=>t.id===id);if(!value)throw new Error('gone');return structuredClone(value);},
      async query(){return windows.flatMap(w=>w.tabs);},
      ...Object.fromEntries(['Created','Removed','Updated','Moved','Detached','Attached','Activated','Replaced'].map(name=>[`on${name}`,event(name.toLowerCase())]))},
    tabGroups:{async query(){return [];},onCreated:event('group-created'),onUpdated:event('group-updated'),onRemoved:event('group-removed')}};
  let model=emptyHistoryState(),status={enabled:false,paused:false,stopped:null,epoch:null,oldest:null,latestSeq:0};
  const db={async status(){return structuredClone(status);},async current(){return structuredClone(model);},
    async configure(v){Object.assign(status,v);},
    async append(state,opts={}){events.push({state:structuredClone(state),...opts});model=structuredClone(state);status.latestSeq++;status.oldest ||= opts.wallTime;return {changed:true,seq:status.latestSeq};},
    async clear(){model=emptyHistoryState();events.length=0;status.oldest=null;},async seek(){return {state:model};},async step(){return null;}};
  const create=()=>createTimeMachineService(api,{database:db,clock:()=>1000+serial++,key:()=>`id-${++serial}`});
  const sender={id:'test',url:api.runtime.getURL('index.html')};
  const command=(service,action,extra={})=>service.handleMessage({type:TIME_MACHINE_PREFIX+action,...extra},sender);
  return {api,db,windows,events,handlers,tab,create,command,sender,store,session};
}

test('disabled recorder registers synchronously but writes no browsing events until explicit enable',async()=>{
  const f=fixture(),s=f.create();s.register();assert.equal(f.handlers.created.length,1);
  await s.start();await s.accept({type:'created',tab:f.tab(2)});assert.equal(f.events.length,0);
  assert.ok((await f.command(s,'enable')).ok);assert.equal(f.events.length,1);
  await s.accept({type:'created',tab:f.tab(2)});assert.equal(Object.keys((await f.db.current()).tabs).length,2);
});

test('worker recreation preserves identity and does not add a fake session when state is unchanged',async()=>{
  const f=fixture();let s=f.create();await f.command(s,'enable');const before=await f.db.current();
  s=f.create();await s.start();assert.deepEqual(await f.db.current(),before);assert.equal(f.events.length,1);
});

test('queued create/remove/recreate events keep order and separate reused Chrome IDs',async()=>{
  const f=fixture(),s=f.create();await f.command(s,'enable');
  const old=Object.keys((await f.db.current()).tabs)[0];
  await Promise.all([s.accept({type:'removed',id:1}),s.accept({type:'created',tab:f.tab(1,{url:'https://other.test/'})}),s.accept({type:'created',tab:f.tab(2)})]);
  const after=await f.db.current();assert.equal(Object.keys(after.tabs).length,2);
  assert.ok(!after.tabs[old]);assert.equal(f.events[1].kind,'removed');assert.equal(f.events[2].kind,'created');
});

test('pause prevents recording; resume makes a fresh interval with current tabs',async()=>{
  const f=fixture(),s=f.create();await f.command(s,'enable');await f.command(s,'pause');
  await s.accept({type:'removed',id:1});assert.equal(f.events.length,1);
  f.windows[0].tabs=[f.tab(3)];await f.command(s,'resume');
  assert.equal(f.events.at(-1).kind,'resume');assert.equal(f.events.at(-1).boundary,true);
  assert.equal(Object.values((await f.db.current()).tabs)[0].chromeId,3);
});

test('private and popup windows and unrelated/loading updates stay outside recorder',async()=>{
  const f=fixture(),s=f.create();s.register();await f.command(s,'enable');
  await s.accept({type:'created',tab:f.tab(5,{incognito:true})});
  f.windows.push({id:2,type:'popup',tabs:[]});await s.accept({type:'created',tab:f.tab(6,{windowId:2})});
  const count=f.events.length;f.handlers.updated[0](1,{status:'loading'},f.tab(1));await s.start();
  assert.equal(f.events.length,count);assert.equal(Object.keys((await f.db.current()).tabs).length,1);
});

test('detached tab survives source window closure until attachment to its new window',async()=>{
  const f=fixture(),s=f.create();await f.command(s,'enable');const old=Object.keys((await f.db.current()).tabs)[0];
  f.windows.push({id:2,type:'normal',tabs:[]});
  await s.accept({type:'detached',id:1});await s.accept({type:'window-removed',id:1});
  await s.accept({type:'attached',id:1,windowId:2,index:0});
  const current=await f.db.current();assert.equal(current.tabs[old].chromeId,1);
  assert.equal(current.windows[current.tabs[old].windowKey].chromeId,2);assert.equal(current.tabs[old].detached,undefined);
});

test('quota failure stops recording and leaves the last durable model and saved-link preferences alone',async()=>{
  const f=fixture(),s=f.create();f.store.deferred=[{url:'https://saved.test/'}];await f.command(s,'enable');
  const before=await f.db.current();f.db.append=async()=>{const e=new Error('full');e.name='QuotaExceededError';throw e;};
  await s.accept({type:'created',tab:f.tab(2)});assert.deepEqual(await f.db.current(),before);
  assert.match((await f.command(s,'status')).data.stopped,/space/);
  assert.deepEqual(f.store.deferred,[{url:'https://saved.test/'}]);
});

test('messages from websites, popup, or incognito and invalid seek arguments are rejected',async()=>{
  const f=fixture(),s=f.create();
  for(const sender of [{id:'test',url:'https://evil.test/'},{id:'test',url:'chrome-extension://test/popup.html'},{...f.sender,tab:{incognito:true}},{id:'other',url:f.sender.url}]){
    assert.equal((await s.handleMessage({type:TIME_MACHINE_PREFIX+'enable'},sender)).code,'FORBIDDEN');
  }
  assert.equal((await f.command(s,'seek',{time:NaN})).ok,false);assert.equal(f.events.length,0);
});

test('gap navigation validates its time and uses adjacent events rather than a checkpoint sequence',async()=>{
  const f=fixture(),s=f.create(),calls=[];f.db.step=async(...args)=>{calls.push(args);return 2000;};
  assert.equal((await f.command(s,'step',{time:1500,direction:-1})).data,2000);
  assert.deepEqual(calls,[[null,-1,1500]]);
  for(const time of [NaN,-1,'1500',null])assert.equal((await f.command(s,'step',{time,direction:1})).ok,false);
  assert.equal(calls.length,1);
});

test('startup write failure leaves old history, status and explicit Clear usable',async()=>{
  const f=fixture(),first=f.create();f.store.deferred=[{url:'https://saved.test/'}];await f.command(first,'enable');
  const old=await f.db.current(),append=f.db.append;delete f.session['tab-atlas-time-machine-epoch'];
  f.db.append=async()=>{const error=new Error('Full');error.name='QuotaExceededError';throw error;};
  const restarted=f.create();await restarted.start();
  const status=await f.command(restarted,'status');assert.equal(status.ok,true);assert.match(status.data.stopped,/space/);
  assert.deepEqual(await f.db.current(),old);
  f.db.append=append;assert.equal((await f.command(restarted,'clear')).ok,true);
  assert.deepEqual(f.store.deferred,[{url:'https://saved.test/'}]);
});

test('cold-worker ownership observations wait for the session epoch before applying user edits',async()=>{
  const f=fixture(),first=f.create();await f.command(first,'enable');
  let operation={id:'restore',epoch:f.session['tab-atlas-time-machine-epoch'],status:'complete',created:[{id:1,windowId:1,url:'https://example.test/1',pinned:false,changed:false}]};
  const status=f.db.status;f.db.status=async()=>({...await status(),lastRestore:structuredClone(operation)});
  f.db.putOperation=async value=>{operation=structuredClone(value);};
  const restarted=f.create();restarted.register();f.handlers.moved[0](1,{toIndex:0});await restarted.start();
  assert.equal(operation.created[0].changed,true);
});

test('startup uses new historical identities while retaining the older session',async()=>{
  const f=fixture(),s=f.create();s.register();await f.command(s,'enable');const old=Object.keys((await f.db.current()).tabs)[0];
  delete f.session['tab-atlas-time-machine-epoch'];
  f.handlers.startup[0]();await s.start();const now=await f.db.current();assert.ok(!now.tabs[old]);
  assert.equal(f.events.length,2);assert.equal(f.events.at(-1).kind,'session');
});

test('cold startup records one session boundary even when initialization and onStartup overlap',async()=>{
  const f=fixture(),first=f.create();await f.command(first,'enable');
  delete f.session['tab-atlas-time-machine-epoch'];
  const next=f.create();next.register();f.handlers.startup[0]();await next.start();
  assert.equal(f.events.length,2);assert.equal(f.events.at(-1).kind,'session');
});

test('corrupt current history leaves status and explicit Clear available without touching saved data',async()=>{
  const f=fixture();f.store.deferred=[{url:'https://saved.test/'}];
  f.db.current=async()=>{const error=new Error('Missing dictionary entry');error.code='CORRUPT';throw error;};
  const s=f.create();await s.start();
  const status=await f.command(s,'status');assert.equal(status.ok,true);assert.match(status.data.stopped,/could not be read/);
  const cleared=await f.command(s,'clear');assert.equal(cleared.ok,true);assert.equal(cleared.data.oldest,null);
  assert.deepEqual(f.store.deferred,[{url:'https://saved.test/'}]);
});
