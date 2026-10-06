export async function checkNativeWorker(assert) {
  const name=`tab-atlas-time-machine-test-worker-${crypto.randomUUID()}`;
  let live=[{id:1,type:'normal',tabs:Array.from({length:20},(_,i)=>({id:i+1,windowId:1,index:i,url:`https://worker.example/${i}`,title:`Synthetic ${i}`,pinned:false}))}];
  let worker,sequence=0, pending=new Map();
  function launch(){worker=new Worker('./time-machine-worker.js',{type:'module'});worker.onmessage=({data})=>{
    if(data.event==='live'){live=data.live;return;}
    if(data.id){const item=pending.get(data.id);if(!item)return;pending.delete(data.id);data.error?item.reject(new Error(data.error)):item.resolve(data.result);}
  };}
  const call=payload=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,...payload});});
  const command=async(action,values={})=>{const response=await call({action:'command',request:{type:'tab-atlas/time-machine/'+action,...values}});assert(response.ok,response.error);return response.data;};
  const status=()=>command('status');
  try{
    launch();const first=await call({action:'init',name,live});
    const before=await command('seek',{time:first.latest});
    const removed=live[0].tabs.shift();live[0].tabs.forEach((tab,index)=>tab.index=index);await call({action:'event',live,event:{type:'removed',id:removed.id}});
    const after=await status();assert(after.latestSeq===first.latestSeq+1,'Cross-context event was lost');
    worker.terminate();pending.clear();launch();await call({action:'init',name,live});
    const reopened=await command('seek',{time:first.latest});assert(Object.keys(reopened.state.tabs).length===20,'Worker restart lost prior state');
    assert((await status()).latestSeq===after.latestSeq,'Unchanged worker wake invented history');
    const time=first.latest,keys=Object.keys(before.state.tabs);
    // Remove the live originals so a partial restore really has pages to create.
    live=[{id:1,type:'normal',tabs:[]}];await call({action:'event',live,event:{type:'window-removed',id:1}});
    const op=await command('prepare-restore',{time,keys});await command('start-restore',{id:op.id});
    let running;
    for(let i=0;i<100;i++){running=(await status()).lastRestore;if(running.created.length)break;await new Promise(r=>setTimeout(r,10));}
    assert(running.created.length>0&&running.status==='running','Did not interrupt an active restore');
    worker.terminate();pending.clear();launch();await call({action:'init',name,live});
    const recovered=(await status()).lastRestore;assert(recovered.status==='interrupted','Restore resumed or falsely completed after termination');
    const count=live.flatMap(w=>w.tabs).length;await new Promise(r=>setTimeout(r,100));assert(live.flatMap(w=>w.tabs).length===count,'Restore automatically continued');
    const undo=await command('undo-restore',{id:op.id});assert(undo.closed<=recovered.created.length&&undo.incomplete,'Undo guessed unknown ownership');
    return {firstSeq:first.latestSeq,reopenedSeq:after.latestSeq,ownedAtTermination:recovered.created.length,closed:undo.closed,untrackedLeft:live.flatMap(w=>w.tabs).length,
      boundary:'Native Worker termination, native IndexedDB and postMessage; Chrome APIs are synthetic, not an installed-extension test'};
  }finally{worker?.terminate();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});}
}
