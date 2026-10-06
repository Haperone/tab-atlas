import { createTimeMachineDatabase } from '../extension/lib/time-machine-db.js';
import { createTimeMachineService } from '../extension/lib/time-machine-service.js';
import { captureHistoryState, emptyHistoryState } from '../extension/lib/time-machine-model.js';

// Disposable native IndexedDB + mocked Chrome APIs; this file is never packaged.
export async function setupTimeMachinePreview(api, tabs, params) {
  const event = () => { const listeners=new Set();return {addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),emit:(...args)=>{for(const fn of listeners)fn(...args);}}; };
  for(const name of ['onCreated','onRemoved','onUpdated','onMoved','onAttached','onDetached','onActivated','onReplaced'])api.tabs[name]=event();
  api.runtime.onMessage=event();api.runtime.onStartup=event();
  api.windows.onCreated=event();api.windows.onRemoved=event();
  const windows=[{id:1,type:'normal',incognito:false,focused:true}];
  let nextTab=20000,nextWindow=10,nextGroup=20;
  api.windows.getAll=async()=>windows.map(w=>({...w,tabs:tabs.filter(t=>t.windowId===w.id).map(t=>({active:false,pinned:false,groupId:-1,...t}))}));
  api.windows.get=async id=>{const window=windows.find(w=>w.id===id);if(!window)throw new Error('Window closed');return {...window};};
  api.windows.getLastFocused=async()=>({...windows[0]});
  api.windows.create=async options=>{
    const window={id:nextWindow++,type:'normal',incognito:false,focused:!!options.focused};windows.push(window);api.windows.onCreated.emit(window);
    const tab=await api.tabs.create({windowId:window.id,url:options.url,active:true});return {...window,tabs:[tab]};
  };
  api.tabs.query=async q=>tabs.filter(t=>(q?.windowId==null||t.windowId===q.windowId)&&(q?.groupId==null||t.groupId===q.groupId)).map(t=>({...t}));
  api.tabs.get=async id=>{const tab=tabs.find(t=>t.id===id);if(!tab)throw new Error('Tab closed');return {...tab};};
  api.tabs.create=async options=>{
    if(params.has('history-partial')&&nextTab%4===0){nextTab++;throw new Error('Synthetic Chrome API failure');}
    const tab={id:nextTab++,index:tabs.filter(t=>t.windowId===options.windowId).length,status:'complete',title:'Restored synthetic page',pinned:false,groupId:-1,...options};
    tabs.push(tab);api.tabs.onCreated.emit({...tab});return {...tab};
  };
  api.tabs.update=async(id,info)=>{const tab=tabs.find(t=>t.id===id);if(!tab)throw new Error('Tab closed');Object.assign(tab,info);api.tabs.onUpdated.emit(id,info,{...tab});return {...tab};};
  api.tabs.remove=async ids=>{for(const id of [].concat(ids)){const i=tabs.findIndex(t=>t.id===id);if(i>=0){tabs.splice(i,1);api.tabs.onRemoved.emit(id);}}};
  api.tabs.group=async({tabIds})=>{const id=nextGroup++;for(const tab of tabs)if(tabIds.includes(tab.id)){tab.groupId=id;api.tabs.onUpdated.emit(tab.id,{groupId:id},{...tab});}return id;};
  const databaseName=`tab-atlas-time-machine-preview-${crypto.randomUUID()}`;
  const database=createTimeMachineDatabase({name:databaseName});
  const now=Date.now(), past=now-600000;
  let seed=emptyHistoryState();
  if(!params.has('history-off')){
    const size=Number(params.get('history-size'))||42;
    const historical=Array.from({length:size},(_,i)=>({id:100+i,windowId:i%2+1,index:i>>1,active:i<2,pinned:i<2,groupId:i%3===0?7:-1,url:`https://${['design.example','reading.example','work.example','notes.example'][i%4]}/page/${i}`,title:`${['Design inspiration','Reading list','Project notes','A quiet corner'][i%4]} ${i+1}`}));
    const windows=[1,2].map(id=>({id,type:'normal',tabs:historical.filter(t=>t.windowId===id)}));
    seed=captureHistoryState(windows,[{id:7,windowId:1,title:'Research',color:'green',collapsed:false}],seed,()=>crypto.randomUUID());
    await database.configure({enabled:true,epoch:'preview'});
    await database.append(seed,{wallTime:past,boundary:true,kind:'session'});
    const closed=structuredClone(seed);for(const [key,tab]of Object.entries(closed.tabs))if(tab.chromeId%5===0)delete closed.tabs[key];
    await database.append(closed,{wallTime:past+180000,kind:'removed'});
    await database.configure({paused:true});
    await database.configure({paused:false});
    await database.append(seed,{wallTime:past+420000,boundary:true,kind:'resume'});
  }
  await api.storage.session.set({'tab-atlas-time-machine-epoch':'preview'});
  const service=createTimeMachineService(api,{database,notify:()=>api.runtime.onMessage.emit({type:'tab-atlas/time-machine/changed'})});
  service.register();await service.start();
  const original=api.runtime.sendMessage.bind(api.runtime);
  api.runtime.sendMessage=(message,callback)=>{
    if(message.type.startsWith('tab-atlas/time-machine/')){
      const response=service.handleMessage(message,{id:api.runtime.id,url:api.runtime.getURL('index.html')});
      return callback ? void response.then(callback) : response;
    }
    return original(message,callback || (()=>{}));
  };
  if(params.has('history-performance')){
    // Measure the actual UI/worker boundary, rather than running database work in UI.
    const worker=new Worker(new URL('./time-machine-worker.js',import.meta.url),{type:'module'});
    let sequence=0;const pending=new Map();
    const call=payload=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,...payload});});
    worker.onmessage=({data})=>{
      if(data.event==='changed'){api.runtime.onMessage.emit({type:'tab-atlas/time-machine/changed'});return;}
      if(!data.id)return;const item=pending.get(data.id);if(!item)return;pending.delete(data.id);
      data.error?item.reject(new Error(data.error)):item.resolve(data.result);
    };
    database.close();await call({action:'init',name:databaseName,epoch:'preview',live:await api.windows.getAll()});
    api.runtime.sendMessage=(message,callback)=>{
      if(!message.type.startsWith('tab-atlas/time-machine/'))return original(message,callback || (()=>{}));
      const response=call({action:'command',request:message});
      return callback ? void response.then(callback) : response;
    };
    window.addEventListener('pagehide',()=>worker.terminate());
  }
  window.addEventListener('pagehide',()=>{database.close();indexedDB.deleteDatabase(databaseName);});
  if(params.has('history-error'))api.runtime.sendMessage=async()=>({ok:false,error:'History storage is busy. Close other Tab Atlas pages and retry.'});
}
