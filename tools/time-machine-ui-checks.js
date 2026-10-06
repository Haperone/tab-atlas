import { THEME_OPTIONS } from '../extension/lib/view-config.js';
const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw new Error(message);};
const waitFor=async predicate=>{for(let i=0;i<250;i++){if(predicate())return;await wait(20);}throw new Error('UI condition timed out');};
const click=selector=>{const el=document.querySelector(selector);el.focus();el.click();};
const results=[],samples=[];let recordedMoment=null;
const output=document.createElement('pre');output.id='timeMachineResults';output.hidden=true;document.body.append(output);
const write=running=>{output.textContent=JSON.stringify({running,passed:results.every(r=>r.passed),results,samples},null,2);};
const check=async(name,body)=>{try{await body();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});}write(true);};
const canvas=document.createElement('canvas').getContext('2d');
const color=value=>{canvas.clearRect(0,0,1,1);canvas.fillStyle=value;canvas.fillRect(0,0,1,1);return [...canvas.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
const over=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
const lum=c=>{const v=c.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
async function run(){
  await waitFor(()=>document.querySelector('.folder-toggle'));
  click('#customizeToggle');await waitFor(()=>[...document.querySelectorAll('#contextMenu button')].some(b=>b.textContent==='Time machine…'));
  [...document.querySelectorAll('#contextMenu button')].find(b=>b.textContent==='Time machine…').click();
  await waitFor(()=>document.querySelector('.tm-count').textContent==='15 tabs');
  await check('Preview is a modal and Earlier restores historical data without browser mutations',async()=>{
    const before=await chrome.tabs.query({});click('[data-tm="earlier"]');await waitFor(()=>document.querySelector('.tm-count').textContent.includes('42'));
    recordedMoment=Number(document.querySelector('#tmRange').value);
    assert((await chrome.tabs.query({})).length===before.length,'Preview mutated browser tabs');
    assert(document.querySelector('#timeMachineDialog').matches(':modal'),'Preview is not modal');
    document.querySelector('#globalSearch').focus();assert(document.querySelector('#timeMachineDialog').contains(document.activeElement),'Background took focus');
  });
  await check('Search, selection and restore keep the chosen historical time',async()=>{
    const time=document.querySelector('#tmRange').value;
    const before=await chrome.tabs.query({}),windowIds=new Set(before.map(tab=>tab.windowId));
    const search=document.querySelector('#tmSearch');search.value='Design inspiration 1';search.dispatchEvent(new Event('input'));
    await waitFor(()=>document.querySelectorAll('.tm-card').length===1);
    click('.tm-check');await waitFor(()=>!document.querySelector('[data-tm="restore-selected"]').hidden);
    click('[data-tm="restore-selected"]');await waitFor(()=>document.querySelector('[data-tm="undo"]').hidden===false);
    assert(document.querySelector('#tmRange').value===time,'Live event moved chosen time');
    assert(document.querySelector('[data-tm="restore-selected"]').hidden,'Selection action remains after restore');
    assert(document.activeElement.id==='tmRange','Removed restore action lost focus');
    const added=(await chrome.tabs.query({})).filter(tab=>!before.some(previous=>previous.id===tab.id));
    assert(added.length===1 && windowIds.has(added[0].windowId),'One selected tab opened in a new window');
    search.value='';search.dispatchEvent(new Event('input'));await waitFor(()=>document.querySelectorAll('.tm-card').length===4);
  });
  await check('Notification shares bottom success, countdown, Undo glyph and durable menu action',async()=>{
    const host=window.__tabAtlasSaveNotification?.host, shadow=host?.shadowRoot;
    assert(host&&document.querySelector('#timeMachineDialog').contains(host),'Notification is outside modal focus scope');
    assert(shadow.querySelector('.countdown')&&shadow.querySelector('.undo-glyph'),'Timer or Undo glyph missing');
    shadow.querySelector('.notice').dispatchEvent(new MouseEvent('mouseenter'));
    assert(shadow.querySelector('.notice').classList.contains('undo-ready'),'Hover did not switch to Undo');
    click('.tm-menu summary');click('[data-tm="undo"]');await waitFor(()=>document.querySelector('[data-tm="undo"]').hidden);
    assert((await chrome.tabs.query({})).length===15,'Undo removed unrelated tabs or left unchanged owned tab');
  });
  await check('Uncertain ownership disables Undo and explains that tabs stay open',async()=>{
    const send=chrome.runtime.sendMessage, before=(await chrome.tabs.query({})).map(tab=>tab.id);
    chrome.runtime.sendMessage=async(message,...args)=>{
      const response=await send(message,...args);
      if(message.type==='tab-atlas/time-machine/status' && response?.ok)return {...response,data:{...response.data,lastRestore:{
        id:'synthetic-unsafe-result',epoch:response.data.epoch,status:'interrupted',skipped:0,failed:0,created:[{id:-1,undone:false}],
        unsafeUndo:true,undoableCount:0,incompleteUndo:true,
      }}};
      return response;
    };
    try{
      chrome.runtime.onMessage.emit({type:'tab-atlas/time-machine/changed'});
      await waitFor(()=>!document.querySelector('[data-tm="undo"]').hidden && document.querySelector('[data-tm="undo"]').disabled);
      await waitFor(()=>document.querySelector('.tm-state-message').textContent.includes('Your tabs will stay open.'));
      assert(!document.querySelector('.tm-state-message').textContent.includes('Use Undo last restore'),'Unavailable Undo was recommended');
      assert(document.querySelector('[data-tm="undo"]').title.includes('could not be recorded'),'Disabled Undo lacks an explanation');
      assert(JSON.stringify((await chrome.tabs.query({})).map(tab=>tab.id))===JSON.stringify(before),'Unsafe result changed browser tabs');
    }finally{
      chrome.runtime.sendMessage=send;chrome.runtime.onMessage.emit({type:'tab-atlas/time-machine/changed'});
      await waitFor(()=>document.querySelector('[data-tm="undo"]').hidden);
    }
  });
  await check('All themes preserve text contrast, surface family, named controls and viewport fit',async()=>{
    click('.tm-menu summary');click('[data-tm="storage"]');await waitFor(()=>document.querySelector('.tm-confirm')?.open);
    assert(document.querySelector('.tm-confirm').matches(':modal'),'History clear confirmation is not modal');
    assert(document.activeElement.textContent==='Cancel','Clear confirmation has unsafe initial focus');
    const confirmation=document.querySelector('.tm-confirm').getBoundingClientRect();
    const surface=document.querySelector('.tm-dialog').getBoundingClientRect();
    assert(Math.abs(confirmation.left+confirmation.width/2-(surface.left+surface.width/2))<2 && Math.abs(confirmation.top+confirmation.height/2-(surface.top+surface.height/2))<2,'Confirmation is not centered');
    const root=document.documentElement, original=root.dataset.theme;
    for(const option of THEME_OPTIONS){
      root.dataset.theme=option.id;await wait(40);
      const base=color(getComputedStyle(document.querySelector('.tm-dialog')).backgroundColor);
      for(const [selector,surface]of [['.tm-tab-title','.tm-card'],['.tm-tab-meta','.tm-card'],['.tm-eyebrow','.tm-dialog'],['.tm-count','.tm-dialog'],['#tmSearch','#tmSearch'],['.tm-confirm p','.tm-confirm'],['.tm-confirm .tm-danger','.tm-confirm']]){
        const el=document.querySelector(selector),css=getComputedStyle(el),material=getComputedStyle(document.querySelector(surface));
        const backdrop=over(color(material.backgroundColor),base),bg=selector===surface?backdrop:over(color(css.backgroundColor),backdrop), contrast=ratio(over(color(css.color),bg),bg);
        samples.push({theme:option.id,selector,contrast:+contrast.toFixed(2),background:material.backgroundColor,blur:material.backdropFilter,shadow:material.boxShadow});
        assert(contrast>=4.5,`${option.id} ${selector} contrast ${contrast.toFixed(2)}`);
      }
      for(const el of document.querySelectorAll('.tm-dialog button,.tm-dialog input,.tm-dialog select,.tm-dialog summary')){
        if(!visible(el))continue;assert(el.textContent.trim()||el.getAttribute('aria-label')||el.labels?.length,`Unnamed ${el.tagName}`);
        const rect=el.getBoundingClientRect();assert(rect.left>=-1&&rect.right<=innerWidth+1,`${option.id} clipped ${el.className}`);
      }
      assert(document.querySelector('.tm-shell').scrollWidth<=document.querySelector('.tm-shell').clientWidth+1,`${option.id} horizontal overflow`);
    }
    root.dataset.theme=original;
    [...document.querySelectorAll('.tm-confirm button')].find(b=>b.textContent==='Cancel').click();
    assert(!document.querySelector('.tm-confirm'),'Clear cancellation left confirmation open');
  });
  await check('Menu sits above the timeline and can be reached by keyboard',async()=>{
    click('.tm-menu summary');const menu=document.querySelector('.tm-menu-panel'),rect=menu.getBoundingClientRect();
    const hit=document.elementFromPoint(rect.left+20,document.querySelector('#tmRange').getBoundingClientRect().top+12);
    assert(menu.contains(hit),'Timeline paints above menu');
    const action=document.querySelector('[data-tm="record"]');action.focus();assert(document.activeElement===action,'Menu action cannot focus');
    assert(getComputedStyle(action).outlineStyle!=='none','Focus outline missing');
    document.querySelector('.tm-menu').open=false;
  });
  await check('Reduced motion cancels preview movement',async()=>{
    const latest=(await chrome.runtime.sendMessage({type:'tab-atlas/time-machine/status'})).data.latest;
    await waitFor(()=>Number(document.querySelector('#tmRange').max)===latest);
    click('[data-tm="latest"]');await waitFor(()=>document.querySelector('.tm-count').textContent==='15 tabs'&&document.querySelectorAll('.tm-card').length===9);
    document.documentElement.dataset.motion='reduced';const range=document.querySelector('#tmRange');range.value=recordedMoment;range.dispatchEvent(new Event('input'));
    await waitFor(()=>document.querySelector('.tm-count').textContent==='42 tabs'&&document.querySelectorAll('.tm-card').length===4);
    assert([...document.querySelectorAll('.tm-card')].every(card=>!card.getAnimations().length),'Preview animates with reduced motion');
  });
  await check('Rapid timeline input renders only the final requested moment',async()=>{
    const status=(await chrome.runtime.sendMessage({type:'tab-atlas/time-machine/status'})).data;
    await waitFor(()=>Number(document.querySelector('#tmRange').max)===status.latest);
    const range=document.querySelector('#tmRange');
    for(let i=0;i<100;i++){range.value=i%2?status.latest:status.oldest;range.dispatchEvent(new Event('input'));}
    await waitFor(()=>!document.querySelector('.tm-cards').hasAttribute('aria-busy')&&document.querySelector('.tm-count').textContent==='15 tabs');
    assert(Number(range.value)===status.latest&&document.querySelectorAll('.tm-card').length===9,'An obsolete seek replaced the final request');
    assert((await chrome.tabs.query({})).length===15,'Rapid preview mutated live tabs');
  });
  await check('Time machine makes no automatic external requests',async()=>{
    const external=performance.getEntriesByType('resource').filter(entry=>!entry.name.startsWith(location.origin)&&!entry.name.startsWith('data:')&&!entry.name.startsWith('blob:'));
    assert(!external.length,'An external resource was requested');
  });
  await check('Pause and resume disclose an unavailable interval',async()=>{
    click('.tm-menu summary');click('[data-tm="record"]');
    await waitFor(()=>document.querySelector('.tm-recording-inline').textContent==='Recording paused');await wait(30);
    click('.tm-menu summary');click('[data-tm="record"]');
    await waitFor(()=>document.querySelector('.tm-recording-inline').textContent==='Recording');
    const status=(await chrome.runtime.sendMessage({type:'tab-atlas/time-machine/status'})).data;
    const previous=status.segments.at(-2),next=status.segments.at(-1),range=document.querySelector('#tmRange');
    range.value=Math.floor((previous.end+next.start)/2);range.dispatchEvent(new Event('input'));
    await waitFor(()=>document.querySelector('.tm-count').textContent==='Recording gap');
    assert(document.querySelector('.tm-state-message').textContent.includes("History wasn't recorded"),'Gap lacks explanation');
    assert(!document.querySelectorAll('.tm-card').length&&document.querySelector('[data-tm="restore-all"]').disabled,'Gap has actionable stale tabs');
    assert(!document.querySelector('[data-tm="earlier"]').disabled,'Earlier is disabled inside a gap');
    const gapPosition=Number(range.value);
    click('[data-tm="earlier"]');await waitFor(()=>Number(range.value)!==gapPosition&&!document.querySelector('.tm-cards').hasAttribute('aria-busy'));
    assert(Number(range.value)===previous.end,'Earlier skipped the last recorded event before the gap');
    range.value=Math.floor((previous.end+next.start)/2);range.dispatchEvent(new Event('input'));
    await waitFor(()=>document.querySelector('.tm-count').textContent==='Recording gap'&&!document.querySelector('.tm-cards').hasAttribute('aria-busy'));
    click('[data-tm="later"]');await waitFor(()=>Number(range.value)!==gapPosition&&!document.querySelector('.tm-cards').hasAttribute('aria-busy'));
    assert(Number(range.value)===next.start,'Later skipped the first recorded event after the gap');
    assert(document.activeElement===range,'Reaching the last moment lost keyboard focus when Later became disabled');
  });
  await check('Clear while paused shows an empty state and Resume starts a fresh baseline',async()=>{
    click('.tm-menu summary');click('[data-tm="record"]');await waitFor(()=>document.querySelector('.tm-recording-inline').textContent==='Recording paused');
    click('.tm-menu summary');click('[data-tm="storage"]');await waitFor(()=>document.querySelector('.tm-confirm')?.open);
    [...document.querySelectorAll('.tm-confirm button')].find(b=>b.textContent==='Clear history').click();
    await waitFor(()=>document.querySelector('.tm-count').textContent==='No recorded moments');
    assert(document.querySelector('#tmRange').disabled&&document.querySelector('#tmSearch').disabled,'Empty history controls are active');
    assert(document.querySelector('.tm-state-message').textContent.includes('paused')&&!document.querySelectorAll('.tm-card').length,'Paused empty state is ambiguous');
    click('.tm-menu summary');click('[data-tm="record"]');await waitFor(()=>document.querySelector('.tm-count').textContent==='15 tabs');
  });
  await check('A recorded moment with zero tabs remains distinct from no history',async()=>{
    await chrome.tabs.remove((await chrome.tabs.query({})).map(tab=>tab.id));
    const latest=(await chrome.runtime.sendMessage({type:'tab-atlas/time-machine/status'})).data.latest;
    await waitFor(()=>Number(document.querySelector('#tmRange').max)===latest);
    click('[data-tm="latest"]');await waitFor(()=>document.querySelector('.tm-count').textContent==='0 tabs');
    assert(document.querySelector('.tm-state-message').textContent==='No web tabs were open at this moment.','Zero tabs lacks a specific message');
    assert(!document.querySelectorAll('.tm-card').length&&document.querySelector('[data-tm="restore-all"]').disabled,'Empty moment has stale restore actions');
  });
  await check('Escape restores dashboard focus and query',async()=>{
    document.querySelector('#tmRange').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert(!document.querySelector('#timeMachineDialog').open,'Escape did not close preview');
    assert(document.activeElement.id==='customizeToggle','Dashboard focus was not restored');
  });
  write(false);
}
run().catch(error=>{results.push({name:'Harness',passed:false,error:error.message});write(false);});
