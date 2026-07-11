import {
  cleanTitle,
  escapeHtml,
  favIcon,
  friendlyDomain,
  smartTitle,
  stripTitleNoise,
} from './tab-model.js';

export const ICONS = {
  tabs: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};

export const ICON_FOLDER_CHEVRON = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.4" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>`;
export const ICON_DOTS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 20.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>`;
export const ICON_GRIP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`;

export function renderTabChip(tab, groupDomain, urlCounts = {}) {
  let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), groupDomain || '');
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
  } catch {}
  const count = urlCounts[tab.url] || 1;
  const safeUrl = escapeHtml(tab.url || '');
  const duplicate = count > 1
    ? ` <button class="chip-dupe-badge" data-action="dedup-one-url" data-dupe-url="${safeUrl}" title="Close ${count - 1} duplicate${count - 1 !== 1 ? 's' : ''}, keep one">${count}×</button>`
    : '';
  const safeTitle = escapeHtml(label);
  const faviconUrl = favIcon(tab.url, 16);
  return `<div class="page-chip clickable${count > 1 ? ' chip-has-dupes' : ''}" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" draggable="true" title="${safeTitle}">
    ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" draggable="false">` : ''}
    <span class="chip-text">${safeTitle}</span>${duplicate}
    <div class="chip-actions">
      <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
      </button>
      <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>
  </div>`;
}

export function buildOverflowChips(hiddenTabs, urlCounts = {}, expanded = false) {
  const hiddenChips = hiddenTabs.map(tab => renderTabChip(tab, '', urlCounts)).join('');
  return `
    <div class="page-chips-overflow" style="display:${expanded ? 'contents' : 'none'}">${hiddenChips}</div>
    ${expanded ? '' : `<div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`}`;
}

export function renderDomainCard(group, expandedCards = new Set()) {
  const tabs = group.tabs || [];
  const tabCount = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId = `domain-${group.domain.replace(/[^a-z0-9]/g, '-')}`;
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const duplicateUrls = Object.entries(urlCounts).filter(([, count]) => count > 1);
  const hasDuplicates = duplicateUrls.length > 0;
  const totalExtras = duplicateUrls.reduce((sum, [, count]) => sum + count - 1, 0);
  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;
  const duplicateBadge = hasDuplicates
    ? `<span class="open-tabs-badge" style="color:var(--accent-primary);background:rgba(var(--accent-rgb),0.12);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';
  const uniqueTabs = [];
  const seen = new Set();
  for (const tab of tabs) {
    if (!seen.has(tab.url)) {
      seen.add(tab.url);
      uniqueTabs.push(tab);
    }
  }
  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount = uniqueTabs.length - visibleTabs.length;
  const chips = visibleTabs.map(tab => renderTabChip(tab, group.domain, urlCounts)).join('')
    + (extraCount > 0
      ? buildOverflowChips(uniqueTabs.slice(8), urlCounts, expandedCards.has(stableId))
      : '');
  let actions = `
    <button class="action-btn" data-action="start-focus-sweep-domain" data-domain-source="${escapeHtml(group.domain)}">
      Sweep
    </button>
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;
  if (hasDuplicates) {
    const encoded = duplicateUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actions += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${encoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }
  return `
    <div class="mission-card domain-card ${hasDuplicates ? 'has-primary-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${duplicateBadge}
        </div>
        <div class="mission-pages">${chips}</div>
        <div class="actions">${actions}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}

export function renderDeferredItem(item, timeAgo) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = favIcon(item.url, 16);
  const safeUrl = escapeHtml(item.url || '');
  const safeTitle = escapeHtml(item.title || item.url || '');
  return `
    <div class="deferred-item" data-deferred-id="${item.id}" draggable="true">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${safeUrl}" target="_blank" rel="noopener" class="deferred-title" title="${safeTitle}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px">${safeTitle}
        </a>
        <div class="deferred-meta">
          <span>${escapeHtml(domain)}</span>
          <span>${timeAgo(item.savedAt)}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss" aria-label="Dismiss ${safeTitle}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

export function renderArchiveItem(item, timeAgo) {
  const safeId = escapeHtml(item.id || '');
  const safeUrl = escapeHtml(item.url || '');
  const safeTitle = escapeHtml(item.title || item.url || '');
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item" data-deferred-id="${safeId}">
      <a href="${safeUrl}" target="_blank" rel="noopener" class="archive-item-title" title="${safeTitle}">
        ${safeTitle}
      </a>
      <span class="archive-item-date">${ago}</span>
      <div class="archive-item-actions">
        <button class="archive-item-action archive-restore" data-action="restore-archive-item" data-deferred-id="${safeId}" type="button" title="Restore to Saved for later" aria-label="Restore ${safeTitle} to Saved for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 14.25 4.5 9.75m0 0L9 5.25m-4.5 4.5h10.125a4.875 4.875 0 0 1 0 9.75H12" /></svg>
        </button>
        <button class="archive-item-action archive-remove" data-action="remove-archive-item" data-deferred-id="${safeId}" type="button" title="Remove from archive" aria-label="Remove ${safeTitle} from archive">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.35 9m-4.78 0L9.26 9m10.23-3.21c.35.05.7.1 1.04.16m-1.04-.16-.95 12.35a2.25 2.25 0 0 1-2.24 2.08H7.7a2.25 2.25 0 0 1-2.24-2.08L4.5 5.79m14.99 0a48.1 48.1 0 0 0-3.48-.4m-12.04.56c.34-.06.69-.11 1.04-.16m0 0a48.1 48.1 0 0 1 3.48-.4m7.52 0V4.48c0-1.18-.91-2.16-2.09-2.2a52.1 52.1 0 0 0-3.84 0C8.91 2.32 8 3.3 8 4.48v.91m8.01 0a48.7 48.7 0 0 0-8.01 0" /></svg>
        </button>
      </div>
    </div>`;
}
