import { openModalDialog, closeModalDialog } from './modal-dialog.js';
import { showQuickSaveNotification } from './quick-save-notification.js';
import { formatStorageBytes, storageUsage } from './storage-usage.js';
import { compareAtlasHistory, expandAtlasComparison } from './atlas-history-model.js';
import { createAtlasTimeline } from './atlas-history-timeline.js';

const PREFIX = 'tab-atlas/time-machine/';
const dateText = time => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(time);
const node = (tag, className = '', text) => {
  const value = document.createElement(tag); value.className = className;
  if (text != null) value.textContent = text; return value;
};
const button = (text, action, className = '') => {
  const value = node('button', className, text); value.type = 'button'; if (action) value.dataset.tm = action; return value;
};
const yieldUI = () => {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  // A task boundary without the nested setTimeout clamp on older Chrome.
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
};
const changesText = changes => ['folders', 'deferred'].map(key => {
  const value = changes[key]; return `${key === 'folders' ? 'Folders' : 'Saved links'}: ${value.added} added · ${value.removed} removed · ${value.changed} changed`;
}).join('\n');

export function createAtlasHistoryController({ sound = () => {} } = {}) {
  const dialog = node('dialog', 'tm-dialog'); dialog.id = 'timeMachineDialog'; dialog.setAttribute('aria-labelledby', 'tmTitle');
  dialog.innerHTML = `<div class="tm-shell">
    <header class="tm-header"><div><p class="tm-eyebrow">Your Atlas, in time</p><h2 id="tmTitle">Time machine</h2></div>
      <div class="tm-header-actions"><button type="button" class="tm-restore-all" data-tm="restore-all" aria-describedby="tmRestoreMoment" hidden><span>Restore entire Atlas</span></button><details class="tm-menu"><summary aria-label="Time machine options">•••</summary><div class="tm-menu-panel">
        <p class="tm-recording"></p><button type="button" data-tm="record">Enable recording</button>
        <button type="button" data-tm="disable">Turn off recording</button>
        <button type="button" data-tm="before" hidden>Show Before restore</button>
        <button type="button" data-tm="undo" hidden>Undo last restore</button>
        <button type="button" data-tm="storage">History storage…</button>
      </div></details><button type="button" class="tm-close" data-tm="close"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 5-7 7 7 7M5 12h14"/></svg><span>Back to Atlas</span></button></div>
    </header><div class="tm-scroll">
    <div class="tm-error" role="alert" hidden><p></p><button type="button" data-tm="retry">Retry</button></div>
    <section class="tm-capacity" aria-label="History storage warning" hidden><div><p class="tm-capacity-title" role="status"></p><p class="tm-capacity-description">Older snapshots are removed automatically as history fills. Current folders, saved links and the protected Undo point are kept.</p></div><button type="button" data-tm="storage">History storage…</button></section>
    <p class="tm-loading" role="status" hidden>Loading history…</p>
    <p class="tm-empty-history" role="status" hidden>Recording is off. Turn it on from the options menu to keep future changes.</p>
    <aside aria-label="About Time machine"><details class="tm-guide">
      <summary>How it works</summary><div class="tm-guide-content">
        <p>Time machine keeps local snapshots of your folders and saved links. This moment is compared with your layout now.</p>
        <section><h3>Only what’s missing</h3><p>Folders and Saved for later appear when their saved links are missing now. Groups whose links are all still present are hidden. Deleted empty folders also appear.</p></section>
        <dl class="tm-guide-legend"><div><dt><span class="tm-guide-dot" data-presence="missing" aria-hidden="true"></span>Missing now</dt><dd>Red links are no longer active in Atlas. A whole red folder means none of its links remain.</dd></div>
          <div><dt><span class="tm-guide-dot" data-presence="present" aria-hidden="true"></span>Still in Atlas</dt><dd>Green links still exist, even if moved or renamed. They give context alongside missing links.</dd></div></dl>
        <section><h3>Choose a moment</h3><p>Scroll over the timeline to zoom. Earlier and Later move one snapshot at a time. Browsing changes nothing.</p></section>
        <section><h3>Bring it back</h3><p>Select links or folders, then Restore selected. A matching folder offers Replace folder, Add missing links or Restore a copy. Restore entire Atlas brings back this moment’s complete layout.</p><p>Use Undo on the green notification, or Undo last restore in the ••• menu, to return to your previous layout.</p></section>
        <p>Select a link title to open it in your current browser window.</p>
      </div></details></aside>
    <section class="tm-preview" aria-label="Historical Atlas" hidden>
      <div class="tm-time-heading"><time class="tm-date" id="tmRestoreMoment"></time><span class="tm-count"></span></div>
      <div class="tm-timeline"><div class="tm-navigator"></div>
        <div class="tm-time-controls"><button type="button" data-tm="earlier">← Earlier</button><button type="button" data-tm="later">Later →</button><button type="button" data-tm="latest">Latest</button><span class="tm-recording-inline"></span></div></div>
      <div class="tm-search-row"><label class="visually-hidden" for="tmSearch">Search this moment</label><input id="tmSearch" type="search" placeholder="Search this moment…" autocomplete="off"></div>
      <p class="tm-state-message" role="status"></p><button type="button" data-tm="clear-search" hidden>Clear search</button>
      <div class="tm-columns"><section class="tm-inbox-pane" aria-label="Historical Saved for later" hidden><div class="tm-inbox"></div></section>
        <section class="tm-folders-pane" aria-label="Historical folders" hidden><div class="tm-cards"></div><button type="button" class="tm-more-domains" data-tm="more-folders" hidden>Show more folders</button></section></div>
    </section></div>
    <footer class="tm-restore-dock" aria-label="Restore historical Atlas" hidden>
      <div class="tm-restore-context"><strong id="tmRestoreScope" class="tm-restore-scope">Entire Atlas</strong><time id="tmRestoreDate" class="tm-restore-date"></time></div>
      <button type="button" class="tm-clear-selection" data-tm="clear-selection" aria-label="Clear selection" title="Clear selection" hidden>×</button>
      <button type="button" class="tm-primary tm-restore-action" data-tm="restore-selected" aria-describedby="tmRestoreScope tmRestoreDate" hidden>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6"/></svg><span>Restore selected</span></button>
    </footer><div class="tm-detail-tooltip" role="tooltip" hidden></div><p class="visually-hidden tm-announcement" role="status" aria-atomic="true"></p></div>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  const guideLayout = matchMedia('(min-width:1840px)');
  const syncGuideLayout = () => { find('.tm-guide').open = guideLayout.matches; };
  guideLayout.addEventListener('change', syncGuideLayout); syncGuideLayout();
  const guideAside = find('.tm-guide').closest('aside');
  const placeGuide = hasHistory => hasHistory ? find('.tm-time-heading').append(guideAside) : find('.tm-scroll').insertBefore(guideAside, find('.tm-preview'));
  const hideDetail = () => { find('.tm-detail-tooltip').hidden = true; };
  dialog.addEventListener('focusin', event => {
    const target = event.target.closest('.tm-tab,.tm-folder-choice input'), tip = find('.tm-detail-tooltip');
    if (!target?.matches(':focus-visible')) { hideDetail(); return; }
    const details = target.dataset.details || target.closest('.tm-card-header')?.dataset.details;
    const address = target.querySelector('.tm-tab-meta')?.textContent;
    if (!details && !address) { hideDetail(); return; }
    tip.textContent = [address, details].filter(Boolean).join('\n'); tip.hidden = false;
    const rect = target.getBoundingClientRect(), size = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(16, Math.min(rect.left, innerWidth - size.width - 16))}px`;
    tip.style.top = `${Math.max(16, Math.min(rect.top - size.height - 8 >= 16 ? rect.top - size.height - 8 : rect.bottom + 8, innerHeight - size.height - 16))}px`;
  });
  dialog.addEventListener('focusout', hideDetail);
  dialog.addEventListener('scroll', hideDetail, true);
  const resetPaneScroll = () => { for (const pane of dialog.querySelectorAll('.tm-columns > section')) pane.scrollTop = 0; };
  let status = null, result = null, desiredTime = null, pendingTime = null, seeking = false, stepping = false, busy = false, operationLabel = '', session = 0, renderVersion = 0, navigationVersion = 0;
  let folderLimit = 12, rowLimits = new Map(), selectedFolders = new Set(), selectedLinks = new Set(), refreshTimer;
  const announce = text => { find('.tm-announcement').textContent = text; };
  const clearError = () => { find('.tm-error').hidden = true; };
  const report = error => {
    find('.tm-error p').textContent = error.message; find('.tm-error').hidden = false;
    if (dialog.open) find('.tm-error').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  };
  const timeline = createAtlasTimeline(find('.tm-navigator'), { load: query => command('timeline', query), nearest: time => command('nearest', { time }), seek, step: stepMoment, announce, report });
  async function command(action, data = {}) {
    const response = await chrome.runtime.sendMessage({ ...data, type: PREFIX + action,
      ...(['seek', 'compare', 'before-restore'].includes(action) ? { comparisonFormat: 'compact-v1' } : {}) });
    if (!response?.ok) throw new Error(response?.error || 'History is unavailable. Reload Tab Atlas at chrome://extensions and refresh this page.');
    return response.data;
  }
  const source = () => result?.pointOperation ? { pointOperation: result.pointOperation } : { time: result?.time };
  const clearSelection = () => { selectedFolders.clear(); selectedLinks.clear(); };
  function play(kind) { try { void Promise.resolve(sound(kind)).catch(() => {}); } catch {} }
  function receipt(text, id, kind = 'save') {
    const style = getComputedStyle(document.documentElement);
    const appearance = { theme: document.documentElement.dataset.theme,
      reducedMotion: document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion:reduce)').matches,
      tokens: Object.fromEntries(['--view-panel-bg', '--view-panel-border', '--view-panel-radius', '--view-panel-shadow', '--view-secondary-text',
        '--view-danger-text', '--text', '--accent-primary', '--accent-success', '--font-sans', '--glass-blur', '--glass-saturation'].map(key => [key, style.getPropertyValue(key).trim()])) };
    showQuickSaveNotification({ ok: true, text, ...(id ? { undoId: id } : {}) }, appearance, location.href, id ? async () => {
      try { return await undo(id) === false ? { ok: false, message: 'Undo cancelled. Current Atlas is unchanged.' } : { ok: true }; }
      catch (error) { return { ok: false, message: error.message }; }
    } : undefined); play(kind);
  }
  function disable(target, value) {
    if (value && document.activeElement === target) find('.tm-close').focus({ preventScroll: true });
    if (target.disabled !== value) target.disabled = value;
    if (target.matches('a[href]')) {
      if (value && !target.hasAttribute('aria-disabled')) target.setAttribute('aria-disabled', 'true');
      else if (!value && target.hasAttribute('aria-disabled')) target.removeAttribute('aria-disabled');
      if (target.tabIndex !== (value ? -1 : 0)) target.tabIndex = value ? -1 : 0;
    }
  }
  function controls(selectionTarget) {
    dialog.setAttribute('aria-busy', String(busy || seeking || stepping));
    const unavailable = busy || seeking || stepping || !result || result.gap || result.time == null;
    if (!selectionTarget) for (const control of dialog.querySelectorAll('[data-tm="restore-all"],[data-tm="restore-selected"],.tm-tab,.tm-check,.tm-domain-restore')) disable(control, unavailable);
    for (const control of dialog.querySelectorAll('[data-tm="record"],[data-tm="disable"],[data-tm="before"],[data-tm="undo"]')) disable(control, busy || seeking || stepping || !status);
    for (const control of dialog.querySelectorAll('[data-tm="storage"]')) disable(control, busy || seeking || stepping);
    timeline.update({ oldest: status?.oldest, latest: status?.latest, time: result?.pointOperation ? null : result?.time ?? desiredTime,
      unavailable: busy || status?.oldest == null || !!result?.pointOperation, version: status?.latestSeq });
    for (const action of ['earlier', 'later', 'latest']) {
      const value = action === 'earlier' ? desiredTime <= status?.oldest : !result?.pointOperation && desiredTime >= status?.latest;
      disable(find(`[data-tm="${action}"]`), busy || !status?.oldest || !!value);
    }
    const hasSelection = !!(selectedFolders.size || selectedLinks.size);
    const dock = find('.tm-restore-dock');
    const restoreAvailable = !!result && !result.gap && result.matchesCurrent === false;
    const hideDock = !restoreAvailable || !hasSelection;
    if (hideDock && dock.contains(document.activeElement)) find('.tm-close').focus({ preventScroll: true });
    dock.hidden = hideDock;
    find('[data-tm="restore-selected"]').hidden = !hasSelection;
    const restoreAll = find('[data-tm="restore-all"]');
    if (!restoreAvailable && document.activeElement === restoreAll) find('.tm-close').focus({ preventScroll: true });
    restoreAll.hidden = !restoreAvailable;
    for (const action of ['restore-all', 'restore-selected']) {
      find(`[data-tm="${action}"] span`).textContent = operationLabel || (action === 'restore-all' ? 'Restore entire Atlas' : 'Restore selected');
    }
    const clear = find('[data-tm="clear-selection"]'); clear.hidden = !hasSelection; disable(clear, busy || seeking);
    const links = hasSelection ? result.state.deferred.filter(link => selectedFolders.has(link.folderId) || selectedLinks.has(link.id)).length : 0;
    find('.tm-restore-scope').textContent = hasSelection
      ? [selectedFolders.size && `${selectedFolders.size} folder${selectedFolders.size === 1 ? '' : 's'}`, links && `${links} link${links === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
      : 'Entire Atlas';
    if (result) {
      const time = find('.tm-restore-date'); time.textContent = dateText(result.wallTime ?? result.time); time.dateTime = new Date(result.wallTime ?? result.time).toISOString();
    }
    const checkboxes = selectionTarget?.dataset.linkId ? [selectionTarget] : dialog.querySelectorAll('.tm-link-check');
    for (const checkbox of checkboxes) {
      const parentSelected = selectedFolders.has(checkbox.dataset.folderId);
      const checked = parentSelected || selectedLinks.has(checkbox.dataset.linkId);
      if (checkbox.checked !== checked) checkbox.checked = checked;
      if (parentSelected && !checkbox.disabled) checkbox.disabled = true;
      const row = checkbox.closest('.tm-row');
      if (checked && row.dataset.selected !== 'true') row.dataset.selected = 'true';
      else if (!checked && row.hasAttribute('data-selected')) delete row.dataset.selected;
    }
    for (const checkbox of dialog.querySelectorAll('.tm-folder-choice input')) {
      const card = checkbox.closest('.tm-card');
      if (checkbox.checked && card.dataset.selected !== 'true') card.dataset.selected = 'true';
      else if (!checkbox.checked && card.hasAttribute('data-selected')) delete card.dataset.selected;
    }
  }
  const showOperation = label => { operationLabel = label; controls(); };
  function updateStatus() {
    const capacity = find('.tm-capacity');
    const usage = Number.isFinite(status.bytes) && status.bytes >= 0 && Number.isFinite(status.budget) && status.budget > 0 ? storageUsage(status.bytes, status.budget) : null;
    const hideCapacity = !usage || usage.level === 'normal';
    if (hideCapacity && capacity.contains(document.activeElement)) find('.tm-close').focus({ preventScroll: true });
    capacity.hidden = hideCapacity;
    if (!hideCapacity) {
      const title = `${usage.level === 'critical' ? 'History almost full' : 'History filling up'} · ${usage.percent}% · ${formatStorageBytes(usage.used)} of ${formatStorageBytes(usage.quota)}`;
      if (find('.tm-capacity-title').textContent !== title) find('.tm-capacity-title').textContent = title;
      find('.tm-capacity-description').textContent = `At ${formatStorageBytes(status.budget)}, older snapshots are removed automatically${Number.isFinite(status.trimTo) && status.trimTo < status.budget ? ` to bring usage towards ${formatStorageBytes(status.trimTo)}` : ''}. Current folders, saved links and the protected Undo point are kept.`;
    }
    const recording = status.stopped ? 'Recording stopped' : status.enabled ? status.paused ? 'Recording paused' : 'Recording' : 'Recording off';
    find('.tm-recording').textContent = find('.tm-recording-inline').textContent = recording;
    const record = find('[data-tm="record"]'); record.textContent = !status.enabled ? 'Enable recording' : status.paused || status.stopped ? 'Resume recording' : 'Pause recording';
    record.dataset.command = !status.enabled ? 'enable' : status.paused || status.stopped ? 'resume' : 'pause';
    find('[data-tm="disable"]').hidden = !status.enabled;
    const op = status.lastRestore, before = find('[data-tm="before"]'), undoButton = find('[data-tm="undo"]');
    before.hidden = undoButton.hidden = !op || op.phase !== 'committed';
    before.textContent = op?.kind === 'undo-restore' ? 'Show Before Undo' : 'Show Before restore';
    undoButton.textContent = op?.kind === 'undo-restore' ? 'Return to previous Atlas' : 'Undo last restore';
    find('.tm-empty-history').hidden = status.oldest != null || status.enabled;
    find('.tm-preview').hidden = status.oldest == null;
    placeGuide(status.oldest != null);
    if (status.stopped) report(new Error(`${status.stopped} Resume recording from the options to retry.`));
    controls();
  }
  async function render() {
    const version = ++renderVersion;
    if (!result) return;
    find('.tm-date').textContent = `${result.pointOperation ? status.lastRestore?.kind === 'undo-restore' ? 'Before Undo · ' : 'Before restore · ' : ''}${dateText(result.wallTime ?? result.time)}`;
    find('.tm-date').dateTime = new Date(result.wallTime ?? result.time).toISOString();
    const state = result.state, terms = find('#tmSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const all = state.deferred.filter(link => !link.completed);
    const comparison = result.comparison ? expandAtlasComparison(state, result.comparison)
      : result.current ? compareAtlasHistory(state, result.current) : null;
    result.matchesCurrent = comparison?.matchesCurrent;
    find('.tm-count').textContent = `${state.folders.length} folder${state.folders.length === 1 ? '' : 's'} · ${all.length} link${all.length === 1 ? '' : 's'}`;
    const holder = find('.tm-cards'), inbox = find('.tm-inbox'), content = find('.tm-columns');
    const previousFocus = content.contains(document.activeElement) ? { ...document.activeElement.dataset } : null;
    const offsets = [...content.children].map(pane => [pane, pane.scrollTop]);
    content.setAttribute('aria-busy', 'true');
    holder.replaceChildren(); inbox.replaceChildren();
    find('.tm-inbox-pane').hidden = find('.tm-folders-pane').hidden = true;
    if (result.gap) { find('.tm-state-message').textContent = 'Recording was paused here. Choose an earlier or later recorded moment.'; content.setAttribute('aria-busy', 'false'); controls(); return; }
    const ids = new Set(state.folders.map(folder => folder.id)), groups = new Map(state.folders.map(folder => [folder.id, []])); groups.set('', []);
    for (const link of all) groups.get(ids.has(link.folderId) ? link.folderId : '').push(link);
    // Keep standalone links reachable before the paginated folder list.
    const folders = [{ id: '', name: 'Saved for later' }, ...state.folders], visible = [];
    for (const folder of folders) {
      const members = groups.get(folder.id), ownMatch = terms.every(term => folder.name.toLowerCase().includes(term));
      // Show only groups with missing links, plus missing empty folders.
      if (comparison && (members.length
        ? members.every(link => comparison.links.get(link.id)?.present)
        : !folder.id || comparison.folders.get(folder.id)?.present)) continue;
      let items = members.filter(link => terms.every(term => `${folder.name} ${link.title || ''} ${link.url || ''}`.toLowerCase().includes(term)));
      // Prioritize missing links before pagination without changing snapshot order.
      if (comparison) items = [
        ...items.filter(link => comparison.links.get(link.id)?.present === false),
        ...items.filter(link => comparison.links.get(link.id)?.present !== false),
      ];
      if (items.length || ownMatch && folder.id) visible.push({ folder, members, items });
    }
    find('.tm-state-message').textContent = visible.length ? '' : terms.length ? `No matches for “${find('#tmSearch').value.trim()}”. Clear search to see changes from this moment.`
      : !all.length && !state.folders.length ? 'Atlas was empty in this moment. Choose another moment to browse saved links.'
      : comparison?.matchesCurrent ? 'This moment matches your Atlas. Choose an earlier moment to find changes.'
      : 'All links from this moment are still in your Atlas. Folder details or order may differ.';
    find('[data-tm="clear-search"]').hidden = !terms.length;
    const inboxGroup = visible.find(group => !group.folder.id), folderGroups = visible.filter(group => group.folder.id);
    find('.tm-inbox-pane').hidden = !inboxGroup;
    find('.tm-folders-pane').hidden = !folderGroups.length;
    for (const { folder, members, items } of [...(inboxGroup ? [inboxGroup] : []), ...folderGroups.slice(0, folderLimit)]) {
      if (version !== renderVersion || !dialog.open) return;
      const card = node(folder.id ? 'article' : 'section', folder.id ? 'tm-card' : 'tm-inbox-list'), header = node('div', 'tm-card-header'), title = node('h3');
      const folderStatus = comparison?.folders.get(folder.id);
      if (folderStatus) {
        card.dataset.presence = folderStatus.present ? 'present' : 'missing'; title.title = folderStatus.description;
        header.dataset.details = folderStatus.description;
      }
      if (comparison) {
        // Compare every member, including rows hidden by search or pagination.
        const present = members.filter(link => comparison.links.get(link.id)?.present).length;
        card.dataset.match = members.length
          ? present === members.length ? 'present' : present === 0 ? 'missing' : 'mixed'
          : folderStatus?.present ? 'present' : 'missing';
      }
      title.setAttribute('aria-label', `${folder.name}${folderStatus ? ' — ' + folderStatus.description : ''}`);
      if (folder.id) {
        const label = node('label', 'tm-folder-choice'), check = node('input', 'tm-check'); check.type = 'checkbox'; check.dataset.folderId = folder.id;
        check.checked = selectedFolders.has(folder.id); check.setAttribute('aria-label', `Select folder ${folder.name}${folderStatus ? ' — ' + folderStatus.description : ''}`); label.append(check, node('bdi', '', folder.name)); title.append(label);
      } else title.textContent = folder.name;
      header.append(title);
      if (folder.id) { const restoreButton = button('Restore…', 'folder', 'tm-domain-restore'); restoreButton.dataset.folderId = folder.id; restoreButton.setAttribute('aria-label', `Restore folder ${folder.name}`); header.append(restoreButton); }
      card.append(header, node('p', 'tm-folder-count', `${members.length} link${members.length === 1 ? '' : 's'}`));
      if (!items.length) card.append(node('p', 'tm-state-message', 'No saved links in this folder at this moment.'));
      const rows = folder.id ? card : node('ul', 'tm-inbox-rows');
      if (!folder.id) card.append(rows);
      const missingCount = items.filter(link => comparison?.links.get(link.id)?.present === false).length;
      const limit = folder.id ? Math.max(rowLimits.get(folder.id) || 10, missingCount) : items.length;
      // Publish large lists incrementally while keeping every missing link exposed.
      (folder.id ? holder : inbox).append(card);
      let rowPosition = 0;
      for (const link of items.slice(0, limit)) {
        const row = node(folder.id ? 'div' : 'li', 'tm-row'), check = node('input', 'tm-check tm-link-check'); check.type = 'checkbox'; check.dataset.linkId = link.id; check.dataset.folderId = folder.id;
        const linkStatus = comparison?.links.get(link.id);
        if (linkStatus) row.dataset.presence = linkStatus.present ? 'present' : 'missing';
        check.checked = selectedLinks.has(link.id) || selectedFolders.has(folder.id); check.setAttribute('aria-label', `Select ${link.title || link.url}${linkStatus ? ' — ' + linkStatus.description : ''}`);
        let navigable = false; try { navigable = ['http:', 'https:', 'file:'].includes(new URL(link.url).protocol); } catch {}
        const open = navigable ? node('a', 'tm-tab') : button('', 'open-link', 'tm-tab');
        if (navigable) { open.href = link.url; open.target = '_blank'; open.rel = 'noopener'; open.dataset.tm = 'open-link'; }
        open.dataset.linkId = link.id; open.title = `${link.url}${linkStatus ? '\n' + linkStatus.description : ''}`;
        if (linkStatus) open.dataset.details = linkStatus.description;
        open.setAttribute('aria-label', `Open link: ${link.title || link.url} — ${link.url}${linkStatus ? ' — ' + linkStatus.description : ''}`);
        const address = node('span', 'tm-tab-meta', link.url); address.dir = 'ltr';
        const choice = node('label', 'tm-link-choice'); choice.title = check.getAttribute('aria-label'); choice.append(check);
        open.append(node('bdi', 'tm-tab-title', link.title || link.url), address); row.append(choice, open); rows.append(row);
        if (++rowPosition % 25 === 0) { await yieldUI(); if (version !== renderVersion || !dialog.open) return; }
      }
      if (items.length > limit) { const more = button(`Show ${Math.min(25, items.length - limit)} more · ${items.length - limit} remaining`, 'more-links', 'tm-more-rows'); more.dataset.folderId = folder.id; more.dataset.visibleCount = limit; card.append(more); }
      if (folder.id && holder.childElementCount % 4 === 0) await yieldUI();
    }
    find('[data-tm="more-folders"]').hidden = folderGroups.length <= folderLimit; controls();
    for (const [pane, top] of offsets) pane.scrollTop = top;
    if (previousFocus && version === renderVersion) {
      const replacement = [...content.querySelectorAll('button,a[href],input')].find(control => Object.keys(previousFocus).every(key => control.dataset[key] === previousFocus[key]));
      (replacement || find('#tmSearch')).focus({ preventScroll: true });
    }
    if (version === renderVersion) content.setAttribute('aria-busy', 'false');
  }
  async function seek(time) {
    if (time == null || !dialog.open) return;
    stepping = false;
    navigationVersion++;
    desiredTime = time; pendingTime = time;
    if (seeking) return;
    seeking = true; const ownSession = session; controls(); find('.tm-loading').textContent = 'Loading moment…'; find('.tm-loading').hidden = false;
    try {
      while (pendingTime != null && dialog.open && ownSession === session) {
        const requested = pendingTime; pendingTime = null;
        const value = await command('seek', { time: requested });
        if (ownSession !== session || !dialog.open) break;
        if (pendingTime != null) continue;
        result = value; desiredTime = value.time ?? requested; clearSelection(); folderLimit = 12; rowLimits.clear(); resetPaneScroll(); await render(); updateStatus();
      }
    } catch (error) { if (ownSession === session && dialog.open) report(error); }
    finally {
      seeking = false; find('.tm-loading').hidden = true; controls();
      if (pendingTime != null && dialog.open) void seek(pendingTime);
    }
  }
  async function stepMoment(direction) {
    const ownSession = session, ownNavigation = ++navigationVersion;
    stepping = true; controls(); find('.tm-loading').textContent = 'Loading moment…'; find('.tm-loading').hidden = false;
    try {
      const time = await command('step', { time: result?.time ?? desiredTime, direction });
      if (time != null && dialog.open && ownSession === session && ownNavigation === navigationVersion) await seek(time);
    } catch (error) { if (dialog.open && ownSession === session && ownNavigation === navigationVersion) throw error; }
    finally { if (ownSession === session && ownNavigation === navigationVersion) { stepping = false; if (!seeking) find('.tm-loading').hidden = true; controls(); } }
  }
  async function refresh() {
    const ownSession = session;
    try {
    const value = await command('status');
    if (ownSession !== session || !dialog.open) return;
    status = value; updateStatus();
    let comparedBySeek = false;
    if (desiredTime == null && status.latest != null) { await seek(status.latest); comparedBySeek = true; }
    if (result?.pointOperation && result.pointOperation !== status.lastRestore?.id) {
      await seek(status.latest); comparedBySeek = true; announce('The protected return point changed. Showing the latest recorded Atlas.');
    }
    // Seek already supplies the current collections for its comparison.
    if (result && !seeking && !comparedBySeek) {
      const comparedResult = result;
      const comparison = await command('compare', source());
      if (ownSession === session && dialog.open && result === comparedResult) { result.current = comparison.current; result.comparison = comparison.comparison; await render(); }
    }
    } catch (error) { if (ownSession === session && dialog.open) throw error; }
  }
  async function modal(title, content, actionLabel, read = () => true, danger = false) {
    const value = node('dialog', 'tm-confirm'), heading = node('h3', '', title), details = node('div', 'tm-confirm-details'), actions = node('div', 'tm-confirm-actions');
    heading.id = 'tmConfirmTitle'; value.setAttribute('aria-labelledby', heading.id); details.append(typeof content === 'string' ? node('p', '', content) : content);
    const cancel = button('Cancel'), proceed = button(actionLabel, null, danger ? 'tm-danger' : 'tm-primary'), error = node('p', 'tm-confirm-error'); error.id = 'tmConfirmError'; error.setAttribute('role', 'alert');
    actions.append(cancel, proceed); value.append(heading, details, error, actions); dialog.append(value);
    return await new Promise(resolve => {
      let invalidControl;
      const done = result => { closeModalDialog(value); value.remove(); resolve(result); };
      const clearValidation = () => { invalidControl?.removeAttribute('aria-invalid'); invalidControl?.removeAttribute('aria-describedby'); invalidControl = null; error.textContent = ''; };
      details.addEventListener('change', event => {
        if (invalidControl && (event.target === invalidControl || event.target.closest('fieldset') === invalidControl.closest('fieldset'))) clearValidation();
      });
      cancel.onclick = () => done(null); proceed.onclick = () => {
        try { done(read()); } catch (reason) {
          clearValidation(); error.textContent = reason.message;
          invalidControl = reason.control || value.querySelector('input:not(:disabled),select:not(:disabled)');
          invalidControl?.setAttribute('aria-invalid', 'true'); invalidControl?.setAttribute('aria-describedby', error.id); invalidControl?.focus();
        }
      };
      openModalDialog(value, () => done(null)); cancel.focus();
    });
  }
  async function resolveConflicts(conflicts, choices) {
    const form = node('div', 'tm-conflict-list'), readers = [];
    for (const [index, conflict] of conflicts.entries()) {
      const fieldset = node('fieldset', 'tm-conflict'), legend = node('legend', '', conflict.name || conflict.title || 'Saved link'); fieldset.append(legend);
      const radios = new Map(), name = `tm-choice-${index}`;
      const invalid = (message, control = fieldset.querySelector('input:not(:disabled)')) => { const error = new Error(message); error.control = control; throw error; };
      const option = (value, text, explanation, disabled = false) => {
        const label = node('label', 'tm-choice-row'), radio = node('input'); radio.type = 'radio'; radio.name = name; radio.value = value; radio.disabled = disabled;
        const copy = node('span'); copy.append(node('strong', '', text), node('small', '', explanation)); label.append(radio, copy); fieldset.append(label); radios.set(value, radio);
      };
      let destination;
      const destinations = folders => {
        const label = node('label', 'tm-destination', 'Existing folder'), select = node('select', 'tm-window');
        if (folders.length > 1) { const empty = node('option', '', 'Choose a folder'); empty.value = ''; select.append(empty); }
        for (const folder of folders) { const item = node('option', '', `${folder.name}${folder.locked ? ' · Locked' : ''}${folder.links != null ? ` · ${folder.links} link${folder.links === 1 ? '' : 's'}` : ''}`); item.value = folder.id; select.append(item); }
        label.append(select); fieldset.append(label); destination = select; return select;
      };
      if (conflict.type === 'folder') {
        const sourceFolder = result.state.folders.find(folder => folder.id === conflict.sourceId), count = result.state.deferred.filter(link => link.folderId === conflict.sourceId).length;
        fieldset.append(node('p', '', `${count} link${count === 1 ? '' : 's'} in this snapshot. A matching name or the same folder identity exists now.`));
        option('replace', 'Replace folder', 'Replace its fields and links. Newer links remain in Before restore for Undo.');
        option('merge', 'Add missing links', 'Keep current links, edits and order. Add only links missing from this folder.');
        option('copy', 'Restore a copy', 'Create a separate folder with a Restored · prefix. Review its exact name next.');
        const select = destinations(conflict.folders), hint = node('p', 'tm-lock-note'); fieldset.append(hint);
        const lockState = () => {
          const locked = conflict.folders.find(folder => folder.id === select.value)?.locked;
          radios.get('replace').disabled = !!locked;
          if (locked) radios.get('replace').checked = false;
          const copying = radios.get('copy').checked;
          select.closest('.tm-destination').hidden = hint.hidden = copying;
          hint.textContent = locked ? 'This folder is locked. Add missing links or restore a copy.' : sourceFolder && conflict.folders.find(folder => folder.id === select.value)?.sameIdentity ? 'This is the same folder, even if it was renamed.' : '';
        }; fieldset.addEventListener('change', lockState); lockState();
      } else if (conflict.type === 'link') {
        fieldset.append(node('p', '', `This link changed since the snapshot. Current title: ${conflict.current.title || conflict.current.url}`));
        option('keep', 'Keep current link', 'Leave its current fields and placement unchanged.');
        option('replace', 'Replace current link', conflict.locked ? 'Unlock its current folder before replacing this link.' : 'Return this link to its historical fields and placement.', !!conflict.locked);
        option('copy', 'Restore a copy', 'Add a separate historical link and keep the current one.');
      } else {
        fieldset.append(node('p', '', 'Its original folder is unavailable. Restore only this link and choose its destination.'));
        if (conflict.folders.length) { option('existing', 'Choose an existing folder', 'Other links in that folder stay unchanged.'); destinations(conflict.folders); }
        if (conflict.parent) {
          option('parent', 'Restore its original folder', 'Create the folder with only selected links, without their neighbours.', !!conflict.nameConflict);
          option('copy-parent', 'Create a prefixed folder', 'Create Restored · ' + conflict.parent.name + ' with only selected links.');
          if (conflict.nameConflict) fieldset.append(node('p', 'tm-lock-note', 'A folder with this name already exists. Choose an existing folder or create a prefixed folder.'));
        }
        if (destination) {
          const visibility = () => { destination.closest('.tm-destination').hidden = !radios.get('existing')?.checked; };
          fieldset.addEventListener('change', visibility); visibility();
        }
      }
      readers.push(() => {
        const mode = [...radios].find(([, radio]) => radio.checked)?.[0];
        if (!mode) invalid(`Choose how to restore ${conflict.name || conflict.title || 'this link'}.`);
        if (conflict.type === 'folder') {
          if (mode !== 'copy' && !destination?.value) invalid('Choose the existing destination folder.', destination);
          choices.folderChoices[conflict.sourceId] = { mode, ...(mode !== 'copy' ? { targetId: destination.value } : {}) };
        } else if (conflict.type === 'link') choices.linkChoices[conflict.sourceId] = { ...choices.linkChoices[conflict.sourceId], mode };
        else {
          if (mode === 'existing' && !destination?.value) invalid('Choose the destination folder.', destination);
          const value = mode === 'inbox' ? { folderId: null } : mode === 'existing' ? { folderId: destination.value } : { parent: mode === 'parent' ? 'restore' : 'copy' };
          choices.linkChoices[conflict.sourceId] = { ...choices.linkChoices[conflict.sourceId], ...value };
        }
      }); form.append(fieldset);
    }
    return await modal('Choose how to restore', form, 'Review restoration', () => { for (const read of readers) read(); return choices; });
  }
  async function restore(selection) {
    if (!result || result.gap || seeking) return;
    showOperation('Reviewing…');
    const request = { ...source(), ...(selection ? { selection } : {}) }, choices = { folderChoices: Object.create(null), linkChoices: Object.create(null) };
    let plan = await command('preview-restore', { ...request, choices }), revision = plan.revision;
    while (plan.status === 'conflict') {
      if (!await resolveConflicts(plan.conflicts, choices)) return;
      plan = await command('preview-restore', { ...request, choices });
      if (plan.revision !== revision) throw new Error('Atlas changed while you were choosing. Review the current data and try restoring again.');
    }
    const names = (plan.folders || []).map(folder => `${folder.name} · ${folder.mode === 'replace' ? 'Replace' : folder.mode === 'merge' ? 'Add missing links' : 'Restore a separate folder'}`).join('\n');
    const created = plan.target.folders.filter(folder => !plan.currentFolders?.some(current => current.id === folder.id)).map(folder => folder.name).join('\n');
    const review = node('div', 'tm-restore-review');
    review.append(node('p', 'tm-review-date', dateText(result.wallTime ?? result.time)),
      node('p', 'tm-review-effect', selection ? 'Only selected items change.' : 'Active folders, links and their order will be replaced.'),
      node('p', 'tm-review-undo', 'Restoring protects your current Atlas for Undo. You can return to it afterwards.'));
    const summary = node('dl', 'tm-change-summary');
    for (const key of ['folders', 'deferred']) {
      const counts = plan.changes[key], values = ['added', 'removed', 'changed'].filter(kind => counts[kind]).map(kind => `${counts[kind]} ${kind}`);
      if (values.length) { const group = node('div'); group.append(node('dt', '', key === 'folders' ? 'Folders' : 'Saved links'), node('dd', '', values.join(' · '))); summary.append(group); }
    }
    if (summary.children.length) review.append(summary);
    if (names) review.append(node('p', 'tm-review-folders', names));
    if (created) review.append(node('p', 'tm-review-folders', `Added folders:\n${created}`));
    if (selection?.linkIds?.length) {
      const chosen = new Set(selection.linkIds), links = result.state.deferred.filter(link => chosen.has(link.id));
      const group = node('section', 'tm-review-links'), heading = node('h4', '', 'Selected links'), list = node('ul');
      for (const link of links.slice(0, 5)) { const item = node('li'); item.append(node('bdi', '', link.title || link.url)); list.append(item); }
      group.append(heading, list);
      if (links.length > 5) group.append(node('p', '', `And ${links.length - 5} more selected link${links.length - 5 === 1 ? '' : 's'}.`));
      review.append(group);
    }
    review.append(node('p', 'tm-review-note', 'Restored links are active. Other archived links stay unchanged.'));
    if (!await modal(selection ? 'Restore selected items?' : 'Restore this Atlas?', review, selection ? 'Restore selected' : 'Restore Atlas', () => true, !selection || plan.changes.deferred.removed > 0)) return;
    find('.tm-loading').textContent = 'Protecting the current Atlas and restoring…'; find('.tm-loading').hidden = false;
    showOperation('Restoring…');
    const saved = await command('restore', { ...request, choices, expectedRevision: revision, id: crypto.randomUUID() });
    clearSelection(); await refresh(); await seek(status.latest);
    if (!saved.changed) { announce('Atlas already matches these items. Nothing changed.'); return; }
    receipt(selection ? 'Selected items restored' : 'Atlas restored', saved.id);
    if (saved.recoveryPending) report(new Error('Atlas was restored. Its return point is saved; history recovery is pending. Retry loading history.'));
  }
  async function undo(id) {
    const ownsBusy = !busy; if (ownsBusy) { busy = true; controls(); }
    const returning = status?.lastRestore?.id === id && status.lastRestore.kind === 'undo-restore';
    try {
    showOperation('Reviewing Undo…');
    const preview = await command('preview-undo', { operationId: id });
    if (preview.alreadyUndone) return;
    if (preview.changedSinceRestore) {
      if (!dialog.open) await open();
      if (!await modal('Return before the restore?', `${changesText(preview.changes)}\n\nAtlas changed after the restore. This Undo replaces those newer edits too; the current Atlas will be protected so you can return to it.`, 'Undo restore', () => true, true)) return false;
    }
    showOperation('Undoing restore…');
    const saved = await command('undo', { id: crypto.randomUUID(), operationId: id, expectedRevision: preview.revision, confirmChanged: preview.changedSinceRestore });
    await refresh(); if (dialog.open) await seek(status.latest); receipt(returning ? 'Previous Atlas restored' : 'Restore undone', saved.id, 'undo');
    if (saved.recoveryPending) report(new Error('Undo committed. Retry loading history to finish its recovery.'));
    } finally { if (ownsBusy) { busy = false; operationLabel = ''; controls(); } }
  }
  async function act(action, target) {
    if (target.closest('.tm-menu-panel')) find('.tm-close').focus({ preventScroll: true });
    find('.tm-menu').open = false;
    if (action === 'close') { close(); return; }
    if (action === 'record' || action === 'disable') { await command(action === 'record' ? target.dataset.command : action); clearError(); await refresh(); return; }
    if (action === 'retry') { clearError(); timeline.invalidate(); if (status?.stopped && status.enabled) await command('resume'); await refresh(); if (desiredTime != null) await seek(desiredTime); return; }
    if (action === 'latest') { await seek(status.latest); return; }
    if (action === 'earlier' || action === 'later') { await stepMoment(action === 'earlier' ? -1 : 1); return; }
    if (action === 'before') { result = await command('before-restore'); desiredTime = result.time; clearSelection(); await render(); controls(); return; }
    if (action === 'clear-search') { find('#tmSearch').value = ''; find('#tmSearch').focus(); await render(); return; }
    if (action === 'clear-selection') {
      const returnFocus = find('.tm-folder-choice input:checked') || find('.tm-link-check:checked:not(:disabled)') || find('#tmSearch');
      clearSelection(); controls();
      for (const checkbox of dialog.querySelectorAll('.tm-folder-choice input')) checkbox.checked = false;
      returnFocus.focus({ preventScroll: true }); announce('Selection cleared. No changes made.'); return;
    }
    if (action === 'more-folders') { folderLimit += 12; await render(); return; }
    if (action === 'more-links') { rowLimits.set(target.dataset.folderId, Number(target.dataset.visibleCount) + 25); await render(); return; }
    if (action === 'open-link') { await command('open-link', { ...source(), linkId: target.dataset.linkId }); return; }
    if (action === 'restore-all') { await restore(); return; }
    if (action === 'restore-selected') { await restore({ folderIds: [...selectedFolders], linkIds: [...selectedLinks] }); return; }
    if (action === 'folder') { await restore({ folderIds: [target.dataset.folderId], linkIds: [] }); return; }
    if (action === 'undo') { await undo(status.lastRestore.id); return; }
    if (action === 'storage') {
      const value = await command('storage-status');
      const usage = value.bytes == null ? 'History usage is unavailable.' : `${formatStorageBytes(value.bytes)} used of a separate ${formatStorageBytes(value.budget)} budget.`;
      const trimming = `At ${formatStorageBytes(value.budget)}, older moments are trimmed automatically${Number.isFinite(value.trimTo) && value.trimTo < value.budget ? ` towards ${formatStorageBytes(value.trimTo)}` : ''}. The protected Undo point is kept.`;
      if (await modal('History storage', `${usage} ${trimming}\n\nClearing deletes recorded moments and the protected return point, including Undo. Current folders, links and archive stay unchanged. Regular backups do not include history.`, 'Clear history', () => true, true)) {
        await command('clear'); result = null; desiredTime = null; clearSelection(); clearError(); await refresh(); announce('History cleared. Current Atlas is unchanged.');
      }
    }
  }
  dialog.addEventListener('click', event => {
    const target = event.target.closest('[data-tm]'); if (!target) return;
    if (target.disabled || target.dataset.busy || busy && target.dataset.tm !== 'close') { event.preventDefault(); return; }
    if (target.matches('a[href]')) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
    }
    const mutation = ['restore-all', 'restore-selected', 'folder', 'undo', 'record', 'disable', 'storage'].includes(target.dataset.tm);
    target.dataset.busy = 'true'; target.setAttribute('aria-busy', 'true'); if (mutation) busy = true; controls();
    const actionSession = session;
    void act(target.dataset.tm, target).catch(error => { if (dialog.open && actionSession === session) report(error); }).finally(() => {
      if (mutation) { busy = false; operationLabel = ''; } delete target.dataset.busy; target.removeAttribute('aria-busy');
      if (!seeking && !stepping && !busy) find('.tm-loading').hidden = true; controls();
      // Disabled restore buttons temporarily yield focus to Close. Return to
      // the dock after review/Cancel, or to its full-restore action after success.
      if (target.matches('.tm-restore-action,.tm-restore-all') && dialog.open && document.activeElement === find('.tm-close')) {
        const next = find(!find('.tm-restore-dock').hidden ? '[data-tm="restore-selected"]' : '[data-tm="restore-all"]');
        if (next && !next.hidden && !next.disabled) next.focus({ preventScroll: true });
      }
    });
  });
  dialog.addEventListener('auxclick', event => { if (event.target.closest('a[aria-disabled="true"]') || busy && event.target.closest('a.tm-tab')) event.preventDefault(); });
  dialog.addEventListener('change', event => {
    const input = event.target; if (!input.matches('.tm-check')) return;
    const set = input.dataset.linkId ? selectedLinks : selectedFolders, id = input.dataset.linkId || input.dataset.folderId;
    if (input.checked) set.add(id); else set.delete(id);
    if (!input.dataset.linkId) for (const link of result.state.deferred.filter(link => link.folderId === id)) selectedLinks.delete(link.id);
    controls(input);
  });
  find('#tmSearch').addEventListener('input', () => { folderLimit = 12; resetPaneScroll(); void render(); });
  chrome.runtime.onMessage.addListener(message => {
    if (message.type !== PREFIX + 'changed' || !dialog.open) return;
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refresh().catch(report), 100);
  });
  dialog.addEventListener('pointerdown', event => {
    hideDetail();
    const menu = find('.tm-menu');
    if (menu.open && !menu.contains(event.target) && !event.target.closest('.tm-confirm')) menu.open = false;
  });
  dialog.addEventListener('keydown', event => {
    const menu = find('.tm-menu');
    if (event.key !== 'Escape' || !menu.open || event.target.closest('.tm-confirm')) return;
    event.preventDefault(); event.stopPropagation();
    menu.open = false; menu.querySelector('summary').focus();
  }, true);
  function close() { session++; renderVersion++; pendingTime = null; clearTimeout(refreshTimer); timeline.reset(); hideDetail(); find('.tm-menu').open = false; find('.tm-columns').setAttribute('aria-busy', 'false'); closeModalDialog(dialog); }
  async function open() {
    session++; status = null; result = null; desiredTime = null; pendingTime = null; stepping = false; timeline.reset(); clearSelection(); folderLimit = 12; rowLimits.clear();
    const ownSession = session;
    find('#tmSearch').value = ''; clearError(); find('.tm-empty-history').hidden = find('.tm-preview').hidden = find('.tm-capacity').hidden = true;
    placeGuide(false);
    find('.tm-loading').textContent = 'Loading history…'; find('.tm-loading').hidden = false;
    openModalDialog(dialog, close); find('.tm-close').focus(); controls();
    try { await refresh(); } catch (error) { if (ownSession === session && dialog.open) report(error); }
    finally { if (ownSession === session && dialog.open && !seeking) find('.tm-loading').hidden = true; }
  }
  async function storageSummary(target) {
    target.textContent = 'Checking history…';
    try { const value = await command('status'); target.textContent = `${formatStorageBytes(value.bytes)} of ${formatStorageBytes(value.budget)} · separate local history. Older moments trim as it fills; the latest protected return point is kept. Manage history in Time machine.`; }
    catch { target.textContent = 'History storage is unavailable. Open Time machine to retry.'; }
  }
  return { open, close, storageSummary };
}
