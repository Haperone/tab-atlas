// Inject a quota fault into a real IDB transaction, after dictionary writes.
// All other requests, transaction completion and rollback remain native.
export function createQuotaFaultFactory(nativeFactory, faultStore = 'events') {
  const faults={remaining:0,count:0};
  const wrapStore=(store,name)=>new Proxy(store,{get(target,key){
    if(key==='put')return(...args)=>{
      if(name===faultStore&&faults.remaining>0){faults.remaining--;faults.count++;throw new DOMException('Synthetic quota fault','QuotaExceededError');}
      return target.put(...args);
    };
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const wrapTransaction=tx=>new Proxy(tx,{get(target,key){
    if(key==='objectStore')return name=>wrapStore(target.objectStore(name),name);
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  },set(target,key,value){return Reflect.set(target,key,value,target);}});
  const wrapDatabase=db=>new Proxy(db,{get(target,key){
    if(key==='transaction')return(...args)=>wrapTransaction(target.transaction(...args));
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  },set(target,key,value){return Reflect.set(target,key,value,target);}});
  const factory={open(...args){
    const request=nativeFactory.open(...args);let database;
    return new Proxy(request,{get(target,key){
      if(key==='result'){database ||= wrapDatabase(target.result);return database;}
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    },set(target,key,value){return Reflect.set(target,key,value,target);}});
  }};
  return {factory,faults,arm:count=>{faults.remaining=count;faults.count=0;}};
}
