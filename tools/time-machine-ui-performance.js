const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const output=document.createElement('pre');output.id='timeMachinePerformance';output.hidden=true;document.body.append(output);
const waitFor=async fn=>{for(let i=0;i<1000;i++){if(fn())return;await wait(10);}throw new Error('Timed out waiting for useful preview');};
const tasks=[],samples=[],phases=[];
async function run(){
  await waitFor(()=>document.querySelector('.folder-toggle'));await wait(100);
  const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration,
    phase:phases.findLast(p=>p.time<=e.startTime)?.label || 'opening',
    attribution:e.attribution?.map(a=>({name:a.name,containerType:a.containerType,containerName:a.containerName}))}))));
  observer.observe({type:'longtask'});
  const click=s=>document.querySelector(s).click();
  click('#customizeToggle');[...document.querySelectorAll('#contextMenu button')].find(b=>b.textContent==='Time machine…').click();
  await waitFor(()=>document.querySelector('.tm-count').textContent==='15 tabs');
  const counts=new MutationObserver(()=>phases.push({time:performance.now(),label:`render ${document.querySelector('.tm-count').textContent}`}));
  counts.observe(document.querySelector('.tm-count'),{childList:true});
  for(let i=0;i<10;i++){
    const began=performance.now();phases.push({time:began,label:`seek 10000 (${i+1})`});click('[data-tm="earlier"]');
    await waitFor(()=>document.querySelector('.tm-count').textContent.replace(/\D/g,'')==='10000' && document.querySelectorAll('.tm-card').length===4);
    samples.push(performance.now()-began);
    phases.push({time:performance.now(),label:`seek latest (${i+1})`});click('[data-tm="latest"]');await waitFor(()=>document.querySelector('.tm-count').textContent==='15 tabs');
  }
  await wait(100);observer.disconnect();counts.disconnect();
  samples.sort((a,b)=>a-b);
  output.textContent=JSON.stringify({passed:tasks.every(t=>t.duration<=50),count:10000,p95UsefulPreviewMs:samples[9],longTasks:tasks,renderedRows:document.querySelectorAll('.tm-row').length,
    environment:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemoryGiB:navigator.deviceMemory ?? null},
    memory:performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,jsHeapSizeLimit:performance.memory.jsHeapSizeLimit,note:'Approximate UI renderer heap; excludes IndexedDB backing files and the separate Worker'}:null,
    note:'Real UI, native IndexedDB and a separate native Worker with postMessage; Chrome APIs are mocked'},null,2);
}
run().catch(error=>output.textContent=JSON.stringify({passed:false,error:error.message}));
