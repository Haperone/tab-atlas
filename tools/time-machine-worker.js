import { createTimeMachineDatabase } from '../extension/lib/time-machine-db.js';
import { createTimeMachineService } from '../extension/lib/time-machine-service.js';
let service, live, api;
const event=()=>({addListener(){}});
const sendState=()=>postMessage({event:'live',live:structuredClone(live)});
self.onmessage=async({data})=>{
  try{
    let result;
    if(data.action==='init'){
      live=structuredClone(data.live);let nextTab=10000,nextWindow=100;
      const values={timeMachinePreferences:{enabled:true,paused:false}},session={'tab-atlas-time-machine-epoch':data.epoch || 'native-worker-fixture'};
      api={runtime:{id:'fixture',getURL:path=>`chrome-extension://fixture/${path}`,onStartup:event()},
        storage:{local:{get:async()=>values,set:async v=>Object.assign(values,v)},session:{get:async()=>session,set:async v=>Object.assign(session,v)}},
        windows:{getAll:async()=>structuredClone(live),get:async id=>structuredClone(live.find(w=>w.id===id)),getLastFocused:async()=>structuredClone(live.find(w=>w.type==='normal'&&!w.incognito)),onCreated:event(),onRemoved:event(),
          create:async opts=>{await new Promise(r=>setTimeout(r,30));const w={id:nextWindow++,type:'normal',tabs:[{id:nextTab++,windowId:nextWindow-1,index:0,url:opts.url,pinned:false,status:'complete'}]};live.push(w);sendState();return structuredClone(w);}},
        tabs:{query:async opts=>structuredClone(live.flatMap(w=>w.tabs).filter(t=>!opts?.windowId||t.windowId===opts.windowId)),
          get:async id=>{const tab=live.flatMap(w=>w.tabs).find(t=>t.id===id);if(!tab)throw new Error('gone');return structuredClone(tab);},
          create:async opts=>{await new Promise(r=>setTimeout(r,30));const w=live.find(w=>w.id===opts.windowId),tab={id:nextTab++,index:w.tabs.length,pinned:false,status:'complete',...opts};w.tabs.push(tab);sendState();return structuredClone(tab);},
          update:async(id,opts)=>{const tab=live.flatMap(w=>w.tabs).find(t=>t.id===id);Object.assign(tab,opts);sendState();return structuredClone(tab);},
          remove:async id=>{for(const w of live)w.tabs=w.tabs.filter(t=>t.id!==id);sendState();},
          group:async()=>7},tabGroups:{query:async()=>[],update:async()=>{},onCreated:event(),onUpdated:event(),onRemoved:event()}};
      for(const name of ['onCreated','onRemoved','onUpdated','onActivated','onMoved','onAttached','onDetached','onReplaced'])api.tabs[name]=event();
      service=createTimeMachineService(api,{database:createTimeMachineDatabase({name:data.name}),notify:()=>postMessage({event:'changed'})});
      service.register();await service.start();result=await service.database.status();
    }else if(data.action==='event'){
      live=data.live;await service.accept(data.event);result=await service.database.status();
    }else if(data.action==='command')result=await service.handleMessage(data.request,{id:'fixture',url:'chrome-extension://fixture/index.html'});
    postMessage({id:data.id,result});
  }catch(error){postMessage({id:data.id,error:error.message});}
};
