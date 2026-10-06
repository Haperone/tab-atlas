import { makeStorageId } from './ids.js';
import { BACKUP_LIMITS, normalizeBackupFolderName } from './backup-data.js';

const collections = ['folders', 'deferred'];
export const ATLAS_HISTORY_LIMITS = Object.freeze({
  budget: 200 * 1024 * 1024, trimTo: 160 * 1024 * 1024,
  checkpointEvents: 200, checkpointMs: 5 * 60 * 1000,
});
export const emptyAtlasState = () => ({ folders: [], deferred: [] });

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const atlasRecordJSON = value => JSON.stringify(canonical(value));

function validate(state) {
  for (const name of collections) {
    if (!Array.isArray(state[name])) throw new Error('Atlas collections are unavailable. Retry without changing saved links.');
    const ids = new Set();
    for (const item of state[name]) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) {
        throw new Error('Atlas contains missing or repeated identifiers. Restore cannot safely continue.');
      }
      ids.add(item.id);
    }
  }
  return state;
}

/** Current collections and protected Undo data retain the ordinary Atlas archive. */
export function captureAtlasState(data) {
  const state = {
    folders: structuredClone(data?.folders ?? []),
    deferred: structuredClone(data?.deferred ?? []).filter(item => !item?.dismissed),
  };
  validate(state);
  // Persisted Chrome collections are JSON data. Round-trip also excludes undefined fields.
  return JSON.parse(JSON.stringify(state));
}

/** Timeline moments contain active links only, independently of the current archive. */
export function captureAtlasHistoryState(data) {
  const state = captureAtlasState(data);
  state.deferred = state.deferred.filter(item => !item.completed);
  return state;
}

/** Presence is identity-based; moved/edited records remain present, with details for hover/focus. */
export function compareAtlasHistory(historical, current) {
  // Comparison only reads records; copying/JSON round-tripping entire collections
  // here would block the UI before its paginated rows can render.
  const [past, now] = [historical, current].map(data => {
    const state = validate({ folders: data?.folders ?? [], deferred: (data?.deferred ?? []).filter(link => !link?.dismissed) });
    return { ...state, deferred: state.deferred.filter(link => !link.completed) };
  });
  const folders = new Map(now.folders.map(folder => [folder.id, folder]));
  const links = new Map(now.deferred.map(link => [link.id, link]));
  return {
    matchesCurrent: collections.every(name => past[name].length === now[name].length
      && past[name].every((record, index) => same(record, now[name][index]))),
    folders: new Map(past.folders.map(folder => {
      const existing = folders.get(folder.id);
      return [folder.id, { present: !!existing, description: !existing ? 'Folder is missing from the current Atlas'
        : existing.name !== folder.name ? `Currently named ${existing.name}` : 'Folder is in the current Atlas' }];
    })),
    links: new Map(past.deferred.map(link => {
      const existing = links.get(link.id), details = [];
      if (existing) {
        if (existing.title !== link.title) details.push(`Current title: ${existing.title || existing.url}`);
        if (existing.url !== link.url) details.push(`Current address: ${existing.url}`);
        if ((existing.folderId || null) !== (link.folderId || null)) details.push(`Currently in ${folders.get(existing.folderId)?.name || 'Saved for later'}`);
      }
      return [link.id, { present: !!existing, description: existing
        ? ['Link is in the current Atlas', ...details].join(' · ') : 'Link is missing from the current active Atlas' }];
    })),
  };
}

/** Compact JSON-safe comparison; unchanged descriptions and link metadata need no copies. */
export function serializeAtlasComparison(historical, current) {
  const comparison = compareAtlasHistory(historical, current);
  const compact = (records, presentText, missingText) => {
    const present = [], details = [];
    for (const [id, status] of records) {
      if (status.present) present.push(id);
      if (status.description !== (status.present ? presentText : missingText)) details.push([id, status.description]);
    }
    return { present, details, presentText, missingText };
  };
  return {
    matchesCurrent: comparison.matchesCurrent,
    folders: compact(comparison.folders, 'Folder is in the current Atlas', 'Folder is missing from the current Atlas'),
    links: compact(comparison.links, 'Link is in the current Atlas', 'Link is missing from the current active Atlas'),
  };
}

/** JSON-safe presence/details transport avoids sending a second full collection. */
export function expandAtlasComparison(historical, comparison) {
  const expand = (records, summary) => {
    const present = new Set(summary.present), details = new Map(summary.details);
    return new Map(records.map(record => [record.id, { present: present.has(record.id),
      description: details.get(record.id) ?? (present.has(record.id) ? summary.presentText : summary.missingText) }]));
  };
  return { matchesCurrent: comparison.matchesCurrent, folders: expand(historical.folders, comparison.folders),
    links: expand(historical.deferred.filter(link => !link.completed && !link.dismissed), comparison.links) };
}

/** Store changed records and an order vector only when the order actually changes. */
export function diffAtlasStates(before, after) {
  validate(before); validate(after);
  const patch = {};
  for (const name of collections) {
    const old = new Map(before[name].map(item => [item.id, item]));
    const next = new Map(after[name].map(item => [item.id, item]));
    const put = after[name].filter(item => !old.has(item.id) || !same(old.get(item.id), item)).map(item => structuredClone(item));
    const remove = before[name].filter(item => !next.has(item.id)).map(item => item.id);
    const order = after[name].map(item => item.id);
    const orderChanged = !same(before[name].map(item => item.id), order);
    if (put.length || remove.length || orderChanged) {
      patch[name] = { put, remove, ...(orderChanged ? { order } : {}) };
    }
  }
  return patch;
}

export function applyAtlasPatch(state, patch) {
  validate(state);
  if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !collections.includes(key))) {
    throw new Error('This Atlas history change is damaged.');
  }
  const result = structuredClone(state);
  for (const name of collections) {
    const change = patch[name];
    if (!change) continue;
    if (!Array.isArray(change.put) || !Array.isArray(change.remove)) throw new Error('This Atlas history change is damaged.');
    const map = new Map(result[name].map(item => [item.id, item]));
    const removed = new Set();
    for (const id of change.remove) {
      if (!map.has(id) || removed.has(id)) throw new Error('This Atlas history change has missing or repeated removals.');
      removed.add(id); map.delete(id);
    }
    const putIds = new Set();
    for (const item of change.put) {
      if (!item?.id || putIds.has(item.id) || removed.has(item.id)) throw new Error('This Atlas history change has repeated identifiers.');
      putIds.add(item.id); map.set(item.id, structuredClone(item));
    }
    const order = change.order ?? result[name].map(item => item.id);
    if (!Array.isArray(order) || order.length !== map.size || new Set(order).size !== map.size || order.some(id => !map.has(id))) {
      throw new Error('The order of this Atlas snapshot is damaged.');
    }
    result[name] = order.map(id => map.get(id));
  }
  return validate(result);
}

export function replayAtlas(checkpoint, events) {
  validate(checkpoint);
  // A seek may replay 199 small edits. Clone the checkpoint once and retain
  // maps/order vectors instead of cloning every unchanged record per event.
  const copied = structuredClone(checkpoint);
  const maps = Object.fromEntries(collections.map(name => [name, new Map(copied[name].map(item => [item.id, item]))]));
  const orders = Object.fromEntries(collections.map(name => [name, copied[name].map(item => item.id)]));
  for (const event of events) {
    const patch = event.patch;
    if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !collections.includes(key))) {
      throw new Error('This Atlas history change is damaged.');
    }
    for (const name of collections) {
      const change = patch[name]; if (!change) continue;
      if (!Array.isArray(change.put) || !Array.isArray(change.remove)) throw new Error('This Atlas history change is damaged.');
      const map = maps[name], removed = new Set(), putIds = new Set();
      let membershipChanged = false;
      for (const id of change.remove) {
        if (!map.has(id) || removed.has(id)) throw new Error('This Atlas history change has missing or repeated removals.');
        removed.add(id); map.delete(id); membershipChanged = true;
      }
      for (const item of change.put) {
        if (typeof item?.id !== 'string' || !item.id || putIds.has(item.id) || removed.has(item.id)) {
          throw new Error('This Atlas history change has repeated identifiers.');
        }
        if (!map.has(item.id)) membershipChanged = true;
        putIds.add(item.id); map.set(item.id, structuredClone(item));
      }
      if (change.order != null) {
        const order = change.order;
        if (!Array.isArray(order) || order.length !== map.size || new Set(order).size !== map.size || order.some(id => !map.has(id))) {
          throw new Error('The order of this Atlas snapshot is damaged.');
        }
        orders[name] = [...order];
      } else if (membershipChanged) {
        // A later event cannot repair an invalid intermediate snapshot.
        throw new Error('The order of this Atlas snapshot is damaged.');
      }
    }
  }
  return validate(Object.fromEntries(collections.map(name => [name, orders[name].map(id => maps[name].get(id))])));
}

export function atlasFolderConflicts(current, historicalFolder) {
  const name = normalizeBackupFolderName(historicalFolder.name);
  return current.folders.filter(folder => folder.id === historicalFolder.id || normalizeBackupFolderName(folder.name) === name)
    .map(folder => ({ id: folder.id, name: folder.name, locked: !!folder.locked,
      sameIdentity: folder.id === historicalFolder.id,
      links: current.deferred.filter(item => item.folderId === folder.id && !item.dismissed).length }));
}

function fitName(text, limit) {
  let result = text.slice(0, Math.max(0, limit));
  if (/[\uD800-\uDBFF]$/u.test(result)) result = result.slice(0, -1);
  return result;
}

export function restoredFolderName(name, folders, prefix = 'Restored · ') {
  const existing = new Set(folders.map(folder => normalizeBackupFolderName(folder.name)));
  const base = `${prefix}${name || 'Untitled folder'}`;
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? '' : ` (${number})`;
    const candidate = fitName(base, BACKUP_LIMITS.nameLength - suffix.length) + suffix;
    if (!existing.has(normalizeBackupFolderName(candidate))) return candidate;
  }
}

function summary(before, after) {
  const patch = diffAtlasStates(before, after), result = {};
  for (const name of collections) {
    const old = new Set(before[name].map(item => item.id)), change = patch[name];
    const added = change?.put.filter(item => !old.has(item.id)).length || 0;
    result[name] = { added, removed: change?.remove.length || 0, changed: (change?.put.length || 0) - added };
  }
  return result;
}

export function planAtlasRestore(current, historical) {
  const before = captureAtlasState(current), target = captureAtlasHistoryState(historical);
  const restoredIds = new Set(target.deferred.map(link => link.id));
  target.deferred.push(...before.deferred.filter(link => link.completed && !restoredIds.has(link.id)));
  return { status: 'ready', target, changes: summary(before, target) };
}

/** Undo restores the exact protected state, including a selected link's former archive state. */
export function planAtlasExactRestore(current, protectedState) {
  const before = captureAtlasState(current), target = captureAtlasState(protectedState);
  return { status: 'ready', target, changes: summary(before, target) };
}

/** Read-only plan; the worker must protect before and validate the revision before commit. */
export function planAtlasFolderRestore(current, historical, folderId, { mode, targetId, idFactory = makeStorageId } = {}) {
  const before = captureAtlasState(current), past = captureAtlasHistoryState(historical);
  const source = past.folders.find(folder => folder.id === folderId);
  if (!source) throw new Error('This folder is unavailable in the chosen snapshot.');
  const conflicts = atlasFolderConflicts(before, source);
  if ((!mode || mode === 'restore') && conflicts.length) return { status: 'conflict', conflicts };
  mode ??= 'restore';
  if (!['restore', 'replace', 'merge', 'copy'].includes(mode)) throw new Error('Choose how to restore this folder.');
  let destination;
  if (mode === 'replace' || mode === 'merge') {
    if (!targetId && conflicts.length === 1) targetId = conflicts[0].id;
    if (!conflicts.some(folder => folder.id === targetId)) throw new Error('Choose the existing folder to restore into.');
    destination = before.folders.find(folder => folder.id === targetId);
    if (destination.locked && mode === 'replace') throw new Error('Unlock this folder before replacing it, or restore a copy.');
  }
  const target = structuredClone(before);
  const folderIds = new Set(target.folders.map(folder => folder.id));
  const memberIds = new Set(target.deferred.map(item => item.id));
  const members = past.deferred.filter(item => item.folderId === source.id);
  const freshId = ids => {
    const id = idFactory(new Set(ids));
    if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('Unable to create a unique identifier. Nothing was restored.');
    ids.add(id); return id;
  };
  let restoredFolder;
  if (mode === 'copy') {
    restoredFolder = { ...source, id: freshId(folderIds), name: restoredFolderName(source.name, target.folders) };
    target.folders.push(restoredFolder);
  } else if (mode === 'restore') {
    restoredFolder = structuredClone(source); target.folders.push(restoredFolder);
  } else if (mode === 'replace') {
    restoredFolder = { ...source, id: destination.id };
    target.folders[target.folders.findIndex(folder => folder.id === destination.id)] = restoredFolder;
    target.deferred = target.deferred.filter(item => item.completed || item.folderId !== destination.id);
    // IDs removed from this folder may be reused; records elsewhere remain untouched.
    memberIds.clear(); for (const item of target.deferred) memberIds.add(item.id);
  } else restoredFolder = destination;

  const existing = target.deferred.filter(item => !item.completed && item.folderId === restoredFolder.id);
  const signatures = new Set(existing.map(item => JSON.stringify([item.url, !!item.completed])));
  const existingIds = new Set(existing.map(item => item.id));
  let skipped = 0;
  for (const item of members) {
    const signature = JSON.stringify([item.url, !!item.completed]);
    if (mode === 'merge' && (existingIds.has(item.id) || signatures.has(signature))) { skipped++; continue; }
    // Reactivating a historical identity must not leave an archived duplicate.
    if (mode !== 'copy') {
      const archivedIndex = target.deferred.findIndex(link => link.id === item.id && link.completed);
      if (archivedIndex >= 0) { target.deferred.splice(archivedIndex, 1); memberIds.delete(item.id); }
    }
    const id = mode === 'copy' || memberIds.has(item.id) ? freshId(memberIds) : item.id;
    memberIds.add(id);
    target.deferred.push({ ...structuredClone(item), id, folderId: restoredFolder.id });
    signatures.add(signature); existingIds.add(item.id);
  }
  validate(target);
  return { status: 'ready', mode, folderId: restoredFolder.id, folderName: restoredFolder.name,
    target, skipped, changes: summary(before, target) };
}

/** Resolve the entire selection before the caller may commit any of it. */
export function planAtlasSelectionRestore(current, historical, selection, { folderChoices = {}, linkChoices = {}, idFactory = makeStorageId } = {}) {
  const before = captureAtlasState(current), past = captureAtlasHistoryState(historical);
  const folderIds = [...new Set(selection?.folderIds || [])], linkIds = [...new Set(selection?.linkIds || [])];
  if (!folderIds.length && !linkIds.length) throw new Error('Choose a folder or saved link to restore.');
  if (folderIds.some(id => !past.folders.some(folder => folder.id === id))
    || linkIds.some(id => !past.deferred.some(link => link.id === id))) throw new Error('Some selected items are unavailable in this snapshot.');
  const conflicts = [], plans = [], usedTargets = new Set();
  let target = structuredClone(before), skipped = 0;
  // Follow historical order, independent of the order checkboxes were clicked.
  for (const source of past.folders.filter(folder => folderIds.includes(folder.id))) {
    const choice = Object.hasOwn(folderChoices, source.id) ? folderChoices[source.id] || {} : {};
    const plan = planAtlasFolderRestore(target, past, source.id, { ...choice, idFactory });
    if (plan.status === 'conflict') {
      conflicts.push({ type: 'folder', sourceId: source.id, name: source.name, folders: plan.conflicts }); continue;
    }
    if (usedTargets.has(plan.folderId)) throw new Error('Two selected folders have the same destination. Choose a separate copy for one of them.');
    usedTargets.add(plan.folderId); target = plan.target; skipped += plan.skipped;
    plans.push({ sourceId: source.id, folderId: plan.folderId, name: plan.folderName, mode: plan.mode });
  }
  const parents = new Map();
  for (const source of past.deferred.filter(link => linkIds.includes(link.id) && !folderIds.includes(link.folderId))) {
    const choice = { ...(Object.hasOwn(linkChoices, source.id) ? linkChoices[source.id] || {} : {}) };
    const existing = target.deferred.find(link => link.id === source.id);
    if (existing?.completed && !choice.mode) choice.mode = 'replace';
    if (existing && same(existing, source) && !Object.hasOwn(choice, 'folderId') && !choice.parent) { skipped++; continue; }
    if (existing && !choice.mode) {
      conflicts.push({ type: 'link', sourceId: source.id, title: source.title, current: structuredClone(existing),
        locked: target.folders.some(folder => folder.id === existing.folderId && folder.locked) }); continue;
    }
    if (choice.mode === 'keep') { skipped++; continue; }
    if (choice.mode && !['replace', 'copy'].includes(choice.mode)) throw new Error('Choose how to restore this saved link.');
    if (existing && choice.mode === 'replace' && target.folders.some(folder => folder.id === existing.folderId && folder.locked)) {
      throw new Error('Unlock this link’s current folder before replacing it, or restore a copy.');
    }
    let folderId = source.folderId || null;
    if (Object.hasOwn(choice, 'folderId')) {
      folderId = choice.folderId || null;
      if (folderId && !target.folders.some(folder => folder.id === folderId)) throw new Error('The chosen destination folder is unavailable.');
    } else if (folderId && !target.folders.some(folder => folder.id === folderId)) {
      if (parents.has(folderId)) folderId = parents.get(folderId);
      else {
        const parent = past.folders.find(folder => folder.id === folderId);
        if (!parent || !choice.parent && atlasFolderConflicts(target, parent).length) {
          conflicts.push({ type: 'destination', sourceId: source.id, title: source.title,
            parent: parent ? structuredClone(parent) : null, folders: target.folders.map(folder => ({ id: folder.id, name: folder.name })),
            ...(parent && atlasFolderConflicts(target, parent).length ? { nameConflict: true } : {}) }); continue;
        }
        const parentMode = choice.parent || 'restore';
        if (!['restore', 'copy'].includes(parentMode)) throw new Error('Choose where to restore this saved link.');
        if (choice.parent === 'restore' && atlasFolderConflicts(target, parent).length) {
          conflicts.push({ type: 'destination', sourceId: source.id, title: source.title,
            parent: structuredClone(parent), folders: target.folders.map(folder => ({ id: folder.id, name: folder.name })), nameConflict: true }); continue;
        }
        const restored = parentMode === 'copy'
          ? { ...parent, id: idFactory(new Set(target.folders.map(folder => folder.id))), name: restoredFolderName(parent.name, target.folders) }
          : structuredClone(parent);
        if (!restored.id || target.folders.some(folder => folder.id === restored.id)) throw new Error('Unable to create a unique folder identifier.');
        target.folders.push(restored); parents.set(folderId, restored.id); folderId = restored.id;
      }
    }
    const restored = { ...structuredClone(source), folderId };
    if (choice.mode === 'copy') {
      const ids = new Set(target.deferred.map(link => link.id)); restored.id = idFactory(ids);
      if (!restored.id || ids.has(restored.id)) throw new Error('Unable to create a unique link identifier.');
    }
    if (existing && choice.mode === 'replace') target.deferred[target.deferred.findIndex(link => link.id === existing.id)] = restored;
    else target.deferred.push(restored);
  }
  // Incomplete choices never expose a partial target that could be committed.
  if (conflicts.length) return { status: 'conflict', conflicts };
  validate(target);
  return { status: 'ready', target, folders: plans, skipped, changes: summary(before, target) };
}
