import { openModalDialog, closeModalDialog } from './modal-dialog.js';
import { showQuickSaveNotification } from './quick-save-notification.js';
import { formatStorageBytes } from './storage-usage.js';
import { isFaviconRequestUrl } from './tab-model.js';

const PREFIX = 'tab-atlas/time-machine/';
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
const dateText = time => new Intl.DateTimeFormat(undefined, { dateStyle:'medium', timeStyle:'medium' }).format(time);
const element = (tag, className, text) => {
  const node = document.createElement(tag); node.className = className;
  if (text != null) node.textContent = text; return node;
};

/** Read-only preview; the worker alone owns recording, restoration and durable Undo. */
export function createTimeMachineController({ sound = () => {} } = {}) {
  const dialog = element('dialog', 'tm-dialog');
  dialog.id = 'timeMachineDialog'; dialog.setAttribute('aria-labelledby','tmTitle');
  dialog.innerHTML = `
    <div class="tm-shell">
      <header class="tm-header">
        <div><p class="tm-eyebrow">Your tabs, in time</p><h2 id="tmTitle">Time machine</h2></div>
        <div class="tm-header-actions">
          <details class="tm-menu"><summary aria-label="Time machine options">•••</summary>
            <div class="tm-menu-panel">
              <p class="tm-recording"></p>
              <button type="button" data-tm="record" disabled>Checking recording…</button>
              <button type="button" data-tm="disable" disabled>Turn off recording</button>
              <label>Window<select class="tm-window" aria-label="Historical window" disabled><option value="all">All windows</option></select></label>
              <button type="button" data-tm="restore-all" disabled>Restore this moment</button>
              <button type="button" data-tm="undo" hidden>Undo last restore</button>
              <button type="button" data-tm="storage">History storage</button>
            </div>
          </details>
          <button type="button" class="tm-close" data-tm="close" aria-label="Close Time machine">×</button>
        </div>
      </header>
      <div class="tm-error" role="alert" hidden><p></p><button type="button" data-tm="retry">Retry</button></div>
      <p class="tm-loading" role="status" hidden>Loading history…</p>
      <div class="tm-onboarding" hidden>
        <h3>Find the tabs you closed.</h3>
        <p>Rewind your open tabs and bring back a page, a domain or a whole moment.</p>
        <p>Recording is off until you enable it. Page addresses, titles, windows and tab groups stay on this device. Private windows are excluded.</p>
        <p>History uses a separate 20 MiB budget and keeps up to 30 days. Older moments are cleared automatically; the available history may be shorter. Regular backups do not include it.</p>
        <button type="button" class="tm-primary" data-tm="enable">Enable local history</button>
      </div>
      <section class="tm-preview" aria-label="Historical tabs" hidden>
        <div class="tm-time-heading"><time class="tm-date"></time><span class="tm-count"></span></div>
        <div class="tm-timeline">
          <label class="visually-hidden" for="tmRange">Recorded moment</label>
          <input id="tmRange" type="range" step="1" min="0" max="1" value="1">
          <div class="tm-markers" aria-hidden="true"></div>
          <div class="tm-time-bounds"><span class="tm-oldest"></span><span class="tm-newest"></span></div>
          <div class="tm-time-controls">
            <button type="button" data-tm="earlier">← Earlier</button>
            <button type="button" data-tm="later">Later →</button>
            <button type="button" data-tm="latest">Latest</button>
            <span class="tm-recording-inline"></span>
          </div>
        </div>
        <div class="tm-search-row"><label class="visually-hidden" for="tmSearch">Search this moment</label><input id="tmSearch" type="search" placeholder="Search this moment…" autocomplete="off"><button type="button" class="tm-primary" data-tm="restore-selected" hidden></button></div>
        <p class="tm-state-message" role="status"></p>
        <div class="tm-cards"></div>
        <button type="button" class="tm-more-domains" data-tm="more-domains" hidden>Show more domains</button>
      </section>
      <div class="tm-progress" hidden><p role="status"></p><progress aria-label="Restore progress"></progress><button type="button" data-tm="stop">Stop</button></div>
      <p class="visually-hidden tm-announcement" role="status" aria-atomic="true"></p>
    </div>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  let status = null, result = null, selected = new Set(), urls = new Set();
  let desiredTime = null, seeking = false, requestVersion = 0, renderVersion = 0, loading = false;
  let domainLimit = 30, rowLimits = new Map(), cards = new Map(), timer, refreshTimer, pendingRead = false;
  let lastNotified = null, sessionRestore = null, errorAction = 'retry';

  async function command(action, data = {}) {
    const response = await chrome.runtime.sendMessage({type:PREFIX+action,...data});
    if (!response) throw new Error('History service is unavailable. Reload Tab Atlas at chrome://extensions, then refresh this page.');
    if (!response?.ok) throw new Error(response?.error || 'History is unavailable. Reload Tab Atlas and retry.');
    return response.data;
  }
  function report(error, retry = 'retry') {
    errorAction = retry; find('.tm-error p').textContent = error.message;
    find('.tm-error').hidden = false;
  }
  function clearError() { find('.tm-error').hidden = true; }
  function announce(text) { find('.tm-announcement').textContent = text; }
  function playSound(kind) {
    try { void Promise.resolve(sound(kind)).catch(() => {}); } catch {}
  }
  function isRunning() { return status?.lastRestore?.status === 'running'; }
  function disable(node, value) {
    if(value && document.activeElement===node){
      const range=find('#tmRange');
      (node!==range && !range.disabled ? range : find('.tm-close')).focus({preventScroll:true});
    }
    node.disabled=value;
  }
  function updatePreviewActions() {
    const unavailable=seeking || !result?.time || result.gap;
    for(const node of dialog.querySelectorAll('.tm-tab,.tm-check,.tm-domain-restore'))disable(node,unavailable || isRunning());
    disable(find('[data-tm="restore-all"]'),unavailable || !Object.values(result?.state.tabs || {}).some(t=>!t.detached) || isRunning());
    disable(find('[data-tm="restore-selected"]'),unavailable || isRunning());
  }
  function reduced() { return document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion:reduce)').matches; }
  function appearance() {
    const style = getComputedStyle(document.documentElement);
    return {theme:document.documentElement.dataset.theme,reducedMotion:reduced(),tokens:Object.fromEntries([
      '--view-panel-bg','--view-panel-border','--view-panel-radius','--view-panel-shadow','--view-secondary-text',
      '--view-danger-text','--text','--accent-primary','--accent-success','--font-sans','--glass-blur','--glass-saturation',
    ].map(key=>[key,style.getPropertyValue(key).trim()]))};
  }
  function notify(text, id = null, ok = true) {
    showQuickSaveNotification({ok,text,undoId:id},appearance(),location.href,id ? async()=>{
      try { await undo(id); return {ok:true}; }
      catch(error) { return {ok:false,message:error.message}; }
    } : undefined);
  }
  function operationText(op) {
    const opened = op.created.length;
    return `${opened} opened · ${op.skipped} skipped${op.failed ? ` · ${op.failed} failed` : ''}${op.groupFailures ? ` · ${op.groupFailures} groups unavailable` : ''}`;
  }
  function updateOperation() {
    const op = status?.lastRestore, progress=find('.tm-progress');
    const running=op?.status==='running'; progress.hidden=!running;
    if(running){
      progress.querySelector('p').textContent=`Restoring ${op.completed} of ${op.total} tabs…`;
      const meter=progress.querySelector('progress');meter.max=Math.max(1,op.total);meter.value=op.completed;
      disable(progress.querySelector('button'),!!op.stopRequested);
      clearTimeout(timer);timer=setTimeout(()=>void refresh().catch(report),500);
    }
    const undoButton=find('[data-tm="undo"]');
    undoButton.hidden=!op || ['planned','running','undone'].includes(op.status) || !(op.undoableCount ?? op.created.filter(t=>!t.undone).length) && !op.unsafeUndo;
    disable(undoButton,op?.epoch!==status?.epoch || !!op?.unsafeUndo);
    undoButton.title=op?.unsafeUndo?'Undo is unavailable because tab changes could not be recorded. Tabs will stay open.':undoButton.disabled?'Undo is unavailable after restarting Chrome':op?operationText(op):'';
    if(op && op.id===sessionRestore && !running && op.status!=='undone' && lastNotified!==op.id){
      lastNotified=op.id;notify(operationText(op),op.created.length ? op.id : null,op.created.length>0 || !op.failed);
      if(op.created.length)playSound('save');
      if(op.incompleteUndo || ['interrupted','stopped'].includes(op.status)) announce(`Restore ${op.status}. ${operationText(op)}. Unknown or changed tabs stay open on Undo.`);
    }
  }
  function updateStatus() {
    if(!status)return;
    const recording=status.stopped?'Recording stopped':!status.enabled?'Recording off':status.paused?'Recording paused':'Recording';
    find('.tm-recording').textContent=recording;
    find('.tm-recording-inline').textContent=recording;
    const action=find('[data-tm="record"]');
    disable(action,false);
    action.textContent=!status.enabled?'Enable recording':status.paused || status.stopped?'Resume recording':'Pause recording';
    action.dataset.command=!status.enabled?'enable':status.paused || status.stopped?'resume':'pause';
    disable(find('[data-tm="disable"]'),false);
    find('[data-tm="disable"]').hidden=!status.enabled;
    find('.tm-onboarding').hidden=status.enabled || !!status.oldest;
    find('.tm-preview').hidden=!status.oldest;
    disable(find('#tmSearch'),!status.oldest);disable(find('.tm-window'),!status.oldest);
    if(!status.oldest){
      disable(find('#tmRange'),true);
      find('.tm-date').textContent='';find('.tm-date').removeAttribute('datetime');find('.tm-count').textContent='No recorded moments';
      find('.tm-oldest').textContent=find('.tm-newest').textContent='';find('.tm-markers').replaceChildren();
      for(const action of ['earlier','later','latest','restore-all'])disable(find(`[data-tm="${action}"]`),true);
    }
    if(status.stopped)report(new Error(status.stopped),'resume');
    if(status.oldest){
      const range=find('#tmRange');range.min=status.oldest;range.max=Math.max(status.latest,status.oldest+1);
      disable(range,status.oldest===status.latest);
      find('.tm-oldest').textContent=dateText(status.oldestWallTime ?? status.oldest);
      find('.tm-newest').textContent=dateText(status.latestWallTime ?? status.latest);
      const markers=find('.tm-markers');markers.replaceChildren();
      for(const segment of [...status.segments.slice(-10),...(status.markers || []).slice(-20)]){
        const marker=element('i','tm-marker');marker.style.left=`${100*((segment.start ?? segment.time)-status.oldest)/Math.max(1,status.latest-status.oldest)}%`;
        marker.title=segment.label || segment.reason.replaceAll('-',' ');markers.append(marker);
      }
    }else if(status.enabled){
      find('.tm-preview').hidden=false;
      find('.tm-state-message').textContent=status.stopped?'No recorded moments are available. Clear history or resume from options.':status.paused?'No recorded moments yet. Recording is paused.':'Recording has started. Your first moment will appear here.';
      find('.tm-cards').replaceChildren();
      cards.clear();
    }
    updateOperation();
  }
  async function refresh() {
    if(loading){pendingRead=true;return;}
    loading=true;
    try{
      status=await command('status');
      urls=new Set((await chrome.tabs.query({})).filter(tab=>!tab.incognito).map(tab=>tab.url));
      if(!dialog.open){updateOperation();return;}
      updateStatus();
      if(status.oldest){
        if(desiredTime==null)await seek(status.latest);
        else if(desiredTime<status.oldest){announce('Older history was cleared to free space');await seek(status.oldest);}
        else if(result)await render();
      }
    }finally{loading=false;find('.tm-loading').hidden=true;if(pendingRead){pendingRead=false;void refresh().catch(report);}}
  }
  async function seek(time) {
    desiredTime=time;requestVersion++;selected.clear();
    find('#tmRange').value=time;find('#tmRange').setAttribute('aria-valuetext',dateText(time));
    find('.tm-date').textContent=dateText(time);find('.tm-date').dateTime=new Date(time).toISOString();
    find('[data-tm="restore-selected"]').hidden=true;
    if(seeking)return;seeking=true;
    updatePreviewActions();
    find('.tm-cards').setAttribute('aria-busy','true');
    try {
      while(dialog.open){
        const version=requestVersion, requested=desiredTime;
        const value=await command('seek',{time:requested});
        if(version!==requestVersion)continue;
        result=value;domainLimit=30;rowLimits.clear();await render();
        if(version===requestVersion)break;
      }
    }catch(error){report(error);}finally{seeking=false;find('.tm-cards').removeAttribute('aria-busy');updatePreviewActions();}
  }
  async function render() {
    if(!result || !dialog.open)return;
    const previousBoxes=new Map([...cards].map(([key,card])=>[key,card.getBoundingClientRect()]));
    const version=++renderVersion, request=requestVersion, groups=new Map(), query=find('#tmSearch').value.trim().toLocaleLowerCase(), windowKey=find('.tm-window').value;
    const tabs=Object.values(result.state.tabs).filter(t=>!t.detached);
    let matches=0;
    for(let i=0;i<tabs.length;i++){
      const tab=tabs[i];
      if((windowKey==='all'||tab.windowKey===windowKey)&&(!query||`${tab.title} ${tab.url}`.toLocaleLowerCase().includes(query))){
        const domain=new URL(tab.url).hostname.replace(/^www\./,'');
        if(!groups.has(domain))groups.set(domain,[]);groups.get(domain).push(tab);matches++;
      }
      if(i%250===249){await yieldUI();if(version!==renderVersion||request!==requestVersion)return;}
    }
    const message=find('.tm-state-message');
    message.textContent=result.gap ? "History wasn't recorded during this period. Choose Earlier or Later." : !result.time?'This moment is no longer available. Choose Latest.':!tabs.length?'No web tabs were open at this moment.':!matches?'No tabs match this search.':'';
    const interval=status.segments.find(segment=>desiredTime>=segment.start&&(segment.end==null||desiredTime<=segment.end));
    if(!message.textContent&&interval?.reason==='clock-change')message.textContent='System time changed. The timeline keeps changes in their recorded order.';
    const operation=status.lastRestore;
    if(operation?.status==='interrupted' && sessionRestore!==operation.id)message.textContent+=`${message.textContent?' ':''}Restore interrupted. ${operationText(operation)}.${operation.unsafeUndo?'':' Use Undo last restore to close unchanged tabs; untracked tabs stay open.'}`;
    if(operation?.unsafeUndo)message.textContent+=`${message.textContent?' ':''}Undo is unavailable because tab changes could not be recorded. Your tabs will stay open.`;
    find('.tm-count').textContent=result.gap?'Recording gap':`${tabs.length.toLocaleString()} tab${tabs.length===1?'':'s'}`;
    const shownTime=result.gap?desiredTime:result.wallTime ?? result.time ?? desiredTime;
    find('.tm-date').textContent=dateText(shownTime);find('.tm-date').dateTime=new Date(shownTime).toISOString();
    find('#tmRange').setAttribute('aria-valuetext',dateText(shownTime));
    disable(find('[data-tm="earlier"]'),(!result.gap && result.seq<=1) || desiredTime<=status.oldest);
    disable(find('[data-tm="later"]'),desiredTime>=status.latest);
    disable(find('[data-tm="latest"]'),desiredTime>=status.latest);
    disable(find('[data-tm="restore-all"]'),result.gap || !tabs.length || isRunning());
    const select=find('.tm-window'), savedWindow=select.value;
    const keys=Object.keys(result.state.windows);
    if(select.dataset.keys!==keys.join('|')){
      select.replaceChildren(new Option('All windows','all'),...keys.map((key,i)=>new Option(`Window ${i+1}`,key)));
      select.dataset.keys=keys.join('|');select.value=keys.includes(savedWindow)?savedWindow:'all';
    }
    const visible=[...groups].sort((a,b)=>a[0].localeCompare(b[0])).slice(0,domainLimit);
    const holder=find('.tm-cards'), keep=new Set();
    let position=0;
    for(const [domain,items] of visible){
      keep.add(domain);let card=cards.get(domain);
      if(!card){
        card=element('article','tm-card');
        const heading=element('div','tm-card-header'), title=element('h3','',domain);
        const icon=element('img','tm-domain-icon');icon.width=icon.height=16;icon.alt='';
        const iconUrl=new URL(chrome.runtime.getURL('/_favicon/'));iconUrl.searchParams.set('pageUrl',items[0].url);iconUrl.searchParams.set('size','16');
        if(isFaviconRequestUrl(iconUrl.href)){icon.src=iconUrl.href;icon.onerror=()=>icon.remove();title.prepend(icon);}
        heading.append(title);
        const restore=element('button','tm-domain-restore','Restore domain');restore.type='button';restore.dataset.tm='restore-domain';restore.dataset.domain=domain;
        restore.setAttribute('aria-label',`Restore ${domain} tabs`);
        heading.append(restore);card.append(heading,element('div','tm-rows'));card._rows=new Map();cards.set(domain,card);
      }
      card._tabs=items;
      const rows=card.querySelector('.tm-rows'), cap=rowLimits.get(domain)||8, rowKeep=new Set();let rowPosition=0;
      for(const tab of items.slice(0,cap)){
        rowKeep.add(tab.key);let row=card._rows.get(tab.key);
        if(!row){
          row=element('div','tm-row');row.dataset.key=tab.key;
          const box=element('input','tm-check');box.type='checkbox';box.dataset.key=tab.key;
          const open=element('button','tm-tab');open.type='button';open.dataset.tm='open-tab';open.dataset.key=tab.key;
          open.append(element('span','tm-tab-title'),element('span','tm-tab-meta'));
          row.append(box,open);card._rows.set(tab.key,row);
        }
        const box=row.querySelector('input'), open=row.querySelector('button');
        box.checked=selected.has(tab.key);box.setAttribute('aria-label',`Select ${tab.title || tab.url}`);
        row.querySelector('.tm-tab-title').textContent=tab.title || tab.url;
        const group=result.state.groups[tab.groupKey];
        row.querySelector('.tm-tab-meta').textContent=`${urls.has(tab.url)?'✓ Already open · ':''}${tab.pinned?'Pinned · ':''}${group?.title?`${group.title} · `:''}${tab.url}`;
        open.title=`${tab.title || tab.url}\n${tab.url}`;open.setAttribute('aria-label',`${urls.has(tab.url)?'Switch to':'Open'} ${tab.title || tab.url}`);
        row.querySelector('.tm-tab-meta').title=tab.url;
        if(rows.children[rowPosition]!==row)rows.insertBefore(row,rows.children[rowPosition]||null);rowPosition++;
      }
      for(const [key,row] of card._rows){if(!rowKeep.has(key)){if(row.contains(document.activeElement))find('#tmRange').focus({preventScroll:true});row.remove();card._rows.delete(key);}}
      let more=card.querySelector('.tm-more-rows');
      if(items.length>cap){if(!more){more=element('button','tm-more-rows');more.type='button';more.dataset.tm='more-rows';more.dataset.domain=domain;card.append(more);}more.textContent=`Show ${Math.min(50,items.length-cap)} more · ${items.length-cap} remaining`;}
      else if(more){
        if(document.activeElement===more)rows.querySelector('.tm-row:last-child .tm-tab')?.focus();
        more.remove();
      }
      if(holder.children[position]!==card)holder.insertBefore(card,holder.children[position]||null);position++;
      if(position%6===0){await yieldUI();if(version!==renderVersion||request!==requestVersion)return;}
    }
    for(const [domain,card] of cards){if(!keep.has(domain)){if(card.contains(document.activeElement))find('#tmRange').focus({preventScroll:true});card.remove();cards.delete(domain);}}
    find('.tm-more-domains').hidden=groups.size<=domainLimit;
    if(find('.tm-more-domains').hidden && document.activeElement===find('.tm-more-domains'))holder.lastElementChild?.querySelector('.tm-domain-restore')?.focus();
    if(!reduced() && holder.dataset.seq!==String(result.seq)){
      // Animate domain cards, never hundreds of individual rows. A new seek interrupts.
      for(const [key,card]of cards){
        const before=previousBoxes.get(key),after=card.getBoundingClientRect();card.getAnimations().forEach(a=>a.cancel());
        if(before && (before.left!==after.left || before.top!==after.top)){
          card.animate([{transform:`translate(${before.left-after.left}px,${before.top-after.top}px)`},{transform:'translate(0,0)'}],{duration:120,easing:'cubic-bezier(.2,0,0,1)'});
        }else if(!before)card.animate([{opacity:0},{opacity:1}],{duration:120,easing:'ease-out'});
      }
    }else if(reduced()){
      for(const card of cards.values())card.getAnimations().forEach(a=>a.cancel());
    }
    holder.dataset.seq=result.seq;
    selected=new Set([...selected].filter(key=>result.state.tabs[key]));updateSelection();updatePreviewActions();
  }
  function updateSelection() {
    const button=find('[data-tm="restore-selected"]');button.hidden=!selected.size;
    button.textContent=`Restore ${selected.size} tab${selected.size===1?'':'s'}`;disable(button,isRunning());
  }
  async function confirm(title, text, actionLabel) {
    const modal=element('dialog','tm-confirm');modal.setAttribute('aria-labelledby','tmConfirmTitle');
    const heading=element('h3','',title);heading.id='tmConfirmTitle';
    const actions=element('div','tm-confirm-actions');
    const cancel=element('button','','Cancel'), proceed=element('button',actionLabel==='Clear history'?'tm-danger':'tm-primary',actionLabel);
    cancel.type=proceed.type='button';actions.append(cancel,proceed);modal.append(heading,element('p','',text),actions);dialog.append(modal);
    return await new Promise(resolve=>{
      const done=value=>{closeModalDialog(modal);modal.remove();resolve(value);};
      cancel.onclick=()=>done(false);proceed.onclick=()=>done(true);openModalDialog(modal,()=>done(false));cancel.focus();
    });
  }
  async function restore(keys) {
    if(seeking || !result?.time || result.gap)return;
    clearError();const op=await command('prepare-restore',{time:result.time,keys});
    if(!op.total){notify(`${op.skipped} already open or repeated · Nothing opened`);return;}
    let confirmed=false;
    if(op.needsConfirmation){
      confirmed=await confirm(`Open ${op.total} tabs?`,`${dateText(op.wallTime ?? op.time)} · ${op.windowCount} new windows. ${op.skipped} already open or repeated addresses will be skipped. You can stop opening tabs or undo the restore.`,`Open ${op.total} tabs`);
      if(!confirmed)return;
    }
    const started=await command('start-restore',{id:op.id,confirmed});
    if(started.needsConfirmation && started.status==='planned'){
      if(await confirm(`Open ${started.total} tabs?`,'The number of open pages changed. Confirm this updated count.',`Open ${started.total} tabs`))await command('start-restore',{id:op.id,confirmed:true});else return;
    }
    sessionRestore=op.id;selected.clear();
    if(document.activeElement===find('[data-tm="restore-selected"]'))find('#tmRange').focus({preventScroll:true});
    updateSelection();await refresh();
  }
  async function undo(id) {
    const data=await command('undo-restore',{id});playSound('undo');
    const text=data.unsafe?'Undo is unavailable because tab changes could not be recorded. Your tabs stayed open.':`${data.closed} closed${data.left?` · ${data.left} changed or expired tabs kept`:''}${data.failed?` · ${data.failed} could not close; retry Undo`:''}${data.incomplete?' · Untracked tabs kept':''}`;
    announce(text);notify(text);await refresh();return data;
  }
  async function storage() {
    const history=await command('status');
    if(await confirm('History storage',`Clear all recorded moments and the last restore's Undo? Saved links and your open tabs will stay.\n\nHistory uses ${formatStorageBytes(history.bytes)} of its separate ${formatStorageBytes(history.budget)} budget. Up to 30 days are kept; older history is trimmed automatically. Regular backups do not include history.`,'Clear history')){
      await command('clear');desiredTime=null;result=null;selected.clear();announce('History cleared. Saved links are unchanged.');await refresh();
    }
  }
  async function act(action, target) {
    if(target.closest('.tm-menu-panel')){
      const range=find('#tmRange');(range.disabled || find('.tm-preview').hidden ? find('.tm-close') : range).focus({preventScroll:true});
    }
    find('.tm-menu').open=false;
    if(action==='close'){close();return;}
    if(action==='retry'){clearError();if(errorAction==='resume')await command('resume');await refresh();if(desiredTime!=null)await seek(desiredTime);return;}
    if(action==='enable' || action==='record' || action==='disable'){
      clearError();find('.tm-loading').textContent='Updating local recording…';find('.tm-loading').hidden=false;
      try{await command(action==='record'?target.dataset.command:action);await refresh();}
      finally{find('.tm-loading').hidden=true;}
      return;
    }
    if(action==='latest'){await seek(status.latest);announce(dateText(result?.wallTime ?? result?.time ?? desiredTime));return;}
    if(action==='earlier'||action==='later'){
      const position=result.gap ? {time:desiredTime} : {seq:result.seq};
      const time=await command('step',{...position,direction:action==='earlier'?-1:1});
      if(time!=null){await seek(time);announce(dateText(result?.wallTime ?? time));}return;
    }
    if(action==='restore-selected'){await restore([...selected]);return;}
    if(action==='restore-all'){await restore(Object.values(result.state.tabs).filter(t=>!t.detached).map(t=>t.key));return;}
    if(action==='restore-domain'){await restore(cards.get(target.dataset.domain)._tabs.map(t=>t.key));return;}
    if(action==='open-tab'){if(!seeking && result?.time && !result.gap)await command('open-tab',{time:result.time,key:target.dataset.key});return;}
    if(action==='more-rows'){rowLimits.set(target.dataset.domain,(rowLimits.get(target.dataset.domain)||8)+50);await render();return;}
    if(action==='more-domains'){domainLimit+=30;await render();return;}
    if(action==='stop'){await command('stop-restore',{id:status.lastRestore.id});await refresh();return;}
    if(action==='undo'){await undo(status.lastRestore.id);return;}
    if(action==='storage'){await storage();}
  }
  dialog.addEventListener('click',event=>{
    const target=event.target.closest('[data-tm]');if(!target)return;
    // Prevent repeated browser mutations while this button's request is pending.
    if(target.disabled || target.dataset.busy)return;target.dataset.busy='true';target.setAttribute('aria-busy','true');
    void act(target.dataset.tm,target).catch(error=>report(error)).finally(()=>{
      if(target.isConnected){delete target.dataset.busy;target.removeAttribute('aria-busy');}
      if(result && status && ['earlier','later','latest'].includes(target.dataset.tm)) {
        disable(find('[data-tm="earlier"]'),(!result.gap && result.seq<=1) || desiredTime<=status.oldest);
        disable(find('[data-tm="later"]'),desiredTime>=status.latest);disable(find('[data-tm="latest"]'),desiredTime>=status.latest);
      }
    });
  });
  find('#tmRange').addEventListener('input',event=>{void seek(Number(event.target.value));});
  find('#tmRange').addEventListener('change',()=>announce(dateText(desiredTime)));
  find('#tmSearch').addEventListener('input',()=>void render());
  find('.tm-window').addEventListener('change',()=>void render());
  dialog.addEventListener('change',event=>{
    if(!event.target.matches('.tm-check'))return;
    const key=event.target.dataset.key;if(event.target.checked)selected.add(key);else selected.delete(key);updateSelection();
  });
  chrome.runtime.onMessage.addListener(message=>{
    if(message.type!==PREFIX+'changed' || (!dialog.open && !sessionRestore))return;
    clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void refresh().catch(report),100);
  });
  function close() {
    requestVersion++;renderVersion++;clearTimeout(timer);clearTimeout(refreshTimer);
    closeModalDialog(dialog);
  }
  async function open() {
    desiredTime=null;result=null;selected.clear();find('#tmSearch').value='';clearError();
    find('.tm-preview').hidden=true;find('.tm-onboarding').hidden=true;find('.tm-count').textContent='Loading history…';
    find('.tm-loading').hidden=false;
    find('.tm-loading').textContent='Loading history…';
    openModalDialog(dialog,close);find('.tm-close').focus();
    try{await refresh();}catch(error){report(error);}
  }
  async function storageSummary(target) {
    target.textContent='Checking history…';
    try {
      const data=await command('status');
      target.textContent=`${formatStorageBytes(data.bytes)} of ${formatStorageBytes(data.budget)} · separate IndexedDB budget. Up to 30 days, trimmed automatically. Regular backups exclude history.`;
    }catch{target.textContent='History usage unavailable. Open Time machine and retry.';}
  }
  return {open,close,storageSummary};
}
