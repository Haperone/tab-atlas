import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAtlasState, captureAtlasHistoryState, compareAtlasHistory, serializeAtlasComparison, expandAtlasComparison, diffAtlasStates, applyAtlasPatch, replayAtlas, atlasFolderConflicts,
  planAtlasRestore, planAtlasFolderRestore, planAtlasSelectionRestore, restoredFolderName } from '../extension/lib/atlas-history-model.js';

const folder = (id, name, extra = {}) => ({ id, name, locked: false, color: null, collapsed: false, ...extra });
const link = (id, folderId, extra = {}) => ({ id, folderId, url: `https://example.test/${id}`, title: id, completed: false, ...extra });
const current = () => ({ folders: [folder('f', 'Work', { color: 'blue' }), folder('other', 'Other')],
  deferred: [link('edited', 'f', { title: 'Current title' }), link('new', 'f'), link('outside', 'other')] });
const historical = () => ({ folders: [folder('f', 'Work', { color: 'green', collapsed: true })],
  deferred: [link('edited', 'f', { title: 'Historical title' }), link('old', 'f'), link('archive', 'f', { completed: true, completedAt: '2026-01-01T00:00:00Z' })] });
const ids = () => { let next = 0; return () => `fresh-${++next}`; };

test('history projection excludes archived payloads, retains inbox, folders and active order, and leaves current data intact', () => {
  const input = current(); input.deferred.push(link('inbox', null), link('archived', 'f', { completed: true, completedAt: 1, note: 'private archive payload' }));
  const before = structuredClone(input), history = captureAtlasHistoryState(input);
  assert.deepEqual(history.deferred.map(item => item.id), ['edited', 'new', 'outside', 'inbox']);
  assert.deepEqual(history.folders, input.folders); assert.deepEqual(input, before);
  assert.equal(JSON.stringify(history).includes('private archive payload'), false);
  assert.deepEqual(captureAtlasState(input).deferred.at(-1), input.deferred.at(-1));
});

test('comparison treats deleted folder, moved link, archived current identity and equal URL with different IDs independently', () => {
  const past = { folders: [folder('gone', 'Gone')], deferred: [link('moved', 'gone'), link('archived', 'gone'), link('deleted', 'gone')] };
  const now = { folders: [folder('current', 'Current')], deferred: [link('moved', 'current', { title: 'Edited' }),
    link('archived', 'current', { completed: true }), link('different', 'current', { url: past.deferred[2].url })] };
  const unchanged = structuredClone([past, now]);
  const comparison = compareAtlasHistory(past, now);
  assert.equal(comparison.folders.get('gone').present, false);
  assert.equal(comparison.links.get('moved').present, true);
  assert.match(comparison.links.get('moved').description, /Current title: Edited/);
  assert.match(comparison.links.get('moved').description, /Currently in Current/);
  assert.equal(comparison.links.get('archived').present, false);
  assert.equal(comparison.links.get('deleted').present, false);
  assert.deepEqual([past, now], unchanged, 'Read-only comparison changed current or historical collections');
});

test('compact comparison survives Chrome JSON transport with moved, missing, archived and prototype-like identities', () => {
  const past = { folders: [folder('__proto__', 'Earlier')], deferred: [link('constructor', '__proto__'), link('missing', '__proto__'), link('archived', '__proto__')] };
  const now = { folders: [folder('__proto__', 'Now'), folder('other', 'Other')], deferred: [link('constructor', 'other', { title: 'Changed' }), link('archived', '__proto__', { completed: true })] };
  const unchanged = structuredClone([past, now]);
  const transported = JSON.parse(JSON.stringify(serializeAtlasComparison(past, now)));
  assert.deepEqual(expandAtlasComparison(past, transported), compareAtlasHistory(past, now));
  assert.deepEqual([past, now], unchanged);
  assert.equal(JSON.stringify(transported).includes('savedAt'), false);
});

test('current snapshot equality ignores archive and unrelated settings but retains active fields and order', () => {
  const past = current(), now = structuredClone(past);
  now.deferred.push(link('archive', 'f', { completed: true }), link('dismissed', null, { dismissed: true }));
  now.theme = 'glass'; now.tabs = [{ url: 'https://example.test/' }];
  assert.equal(compareAtlasHistory(past, now).matchesCurrent, true);
  const transport = JSON.parse(JSON.stringify(serializeAtlasComparison(past, now)));
  assert.equal(expandAtlasComparison(past, transport).matchesCurrent, true);
  for (const change of [
    state => state.folders.reverse(), state => state.deferred.reverse(),
    state => { state.folders[0].name = 'Renamed'; }, state => { state.folders[0].locked = true; },
    state => { state.deferred[0].title = 'Edited'; }, state => { state.deferred[0].folderId = 'other'; },
    state => { state.deferred[0].completed = true; }, state => { state.deferred.push(link('newer', null)); },
  ]) {
    const edited = structuredClone(now); change(edited);
    assert.equal(serializeAtlasComparison(past, edited).matchesCurrent, false);
  }
  const reorderedKeys = JSON.parse(JSON.stringify(past), (_, value) => value && !Array.isArray(value) && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse()) : value);
  assert.equal(compareAtlasHistory(past, reorderedKeys).matchesCurrent, true);
});

test('whole restore reactivates the same identity while preserving unrelated current archive exactly', () => {
  const now = current(), past = historical();
  const selected = link('old', 'other', { completed: true, completedAt: 55 });
  const unrelated = link('unrelated-archive', 'other', { completed: true, completedAt: 99 });
  now.deferred.push(selected, unrelated);
  const result = planAtlasRestore(now, past);
  assert.deepEqual(result.target.deferred.map(item => item.id), ['edited', 'old', 'unrelated-archive']);
  assert.deepEqual(result.target.deferred[1], past.deferred[1]);
  assert.deepEqual(result.target.deferred[2], unrelated);
  assert.equal(now.deferred.find(item => item.id === 'old').completed, true);
});

test('folder restore and merge reactivate archived identities without copies, and keep unselected archive members', () => {
  for (const mode of ['replace', 'merge']) {
    const now = current(), past = historical();
    now.deferred.push(link('old', 'other', { completed: true, completedAt: 55 }), link('untouched', 'f', { completed: true, completedAt: 99 }));
    const untouched = structuredClone(now.deferred.at(-1));
    const result = planAtlasFolderRestore(now, past, 'f', { mode });
    assert.equal(result.target.deferred.filter(item => item.id === 'old').length, 1);
    assert.deepEqual(result.target.deferred.find(item => item.id === 'old'), past.deferred[1]);
    assert.deepEqual(result.target.deferred.find(item => item.id === 'untouched'), untouched);
    assert.equal(result.target.deferred.some(item => item.id === 'archive'), false);
  }
});

test('selecting an archived identity returns it active to its original missing folder without an archive/copy choice', () => {
  const past = historical(), now = { folders: [folder('current', 'Current')], deferred: [link('old', 'current', { completed: true, completedAt: 50 })] };
  const result = planAtlasSelectionRestore(now, past, { linkIds: ['old'] });
  assert.equal(result.status, 'ready'); assert.deepEqual(result.target.deferred, [past.deferred[1]]);
  assert.deepEqual(result.target.folders.at(-1), past.folders[0]);
});

test('capture contains only Atlas collections and archive, excluding legacy tombstones and browser/workspace/settings', () => {
  const input = { ...current(), tabs: [{ url: 'https://private.test/' }], theme: 'glass', workspaceSnapshots: ['workspace'] };
  input.deferred.push(link('archive', 'f', { completed: true, completedAt: 1 }), link('legacy', 'f', { dismissed: true }));
  const state = captureAtlasState(input);
  assert.deepEqual(Object.keys(state), ['folders', 'deferred']);
  assert.equal(state.deferred.some(item => item.completed), true);
  assert.equal(state.deferred.some(item => item.id === 'legacy'), false);
  state.folders[0].name = 'Changed'; assert.equal(input.folders[0].name, 'Work');
});

test('replay preserves records, archive and order through folder rename, reorder and removal', () => {
  const start = current(), second = structuredClone(start);
  second.folders.reverse(); second.folders[1].name = 'Renamed';
  second.deferred.reverse(); second.deferred[1].completed = true;
  const third = structuredClone(second);
  third.folders = third.folders.filter(item => item.id !== 'f');
  third.deferred = third.deferred.map(item => item.folderId === 'f' ? { ...item, folderId: null } : item);
  const patch = diffAtlasStates(start, second);
  assert.deepEqual(applyAtlasPatch(start, patch), second);
  assert.deepEqual(replayAtlas(start, [{ patch }, { patch: diffAtlasStates(second, third) }]), third);
  assert.equal(start.folders[0].name, 'Work');
});

test('bounded replay preserves 1,000 records through 199 mixed edits without mutating checkpoint or events', () => {
  const checkpoint = { folders: [folder('f', 'Work')], deferred: Array.from({ length: 1000 }, (_, index) => link('link-' + index, 'f')) };
  const expected = structuredClone(checkpoint), events = [];
  for (let index = 1; index <= 199; index++) {
    const previous = structuredClone(expected);
    expected.deferred[index].title = `Edit ${index}`;
    if (index % 10 === 0) expected.deferred.reverse();
    if (index % 15 === 0) expected.deferred[index].completed = true;
    events.push({ patch: diffAtlasStates(previous, expected) });
  }
  const originalCheckpoint = structuredClone(checkpoint), originalEvents = structuredClone(events);
  const replayed = replayAtlas(checkpoint, events); assert.deepEqual(replayed, expected);
  replayed.deferred[0].title = 'Result changed';
  assert.deepEqual(checkpoint, originalCheckpoint); assert.deepEqual(events, originalEvents);
});

test('batch replay rejects a damaged intermediate order even if a later patch supplies a correct one', () => {
  const checkpoint = current();
  assert.throws(() => replayAtlas(checkpoint, [
    { patch: { deferred: { put: [link('new-id', 'f')], remove: [] } } },
    { patch: { deferred: { put: [], remove: [], order: [...checkpoint.deferred.map(item => item.id), 'new-id'] } } },
  ]), /order/);
  assert.throws(() => replayAtlas(checkpoint, [{ patch: { deferred: { put: [], remove: ['missing'] } } }]), /removals/);
  assert.throws(() => replayAtlas(checkpoint, [{ patch: { deferred: { put: [link('edited', 'f'), link('edited', 'f')], remove: [] } } }]), /identifiers/);
  assert.throws(() => replayAtlas(checkpoint, [{ patch: { deferred: { put: [], remove: [], order: ['edited', 'edited', 'outside'] } } }]), /order/);
});

test('identical values with different property insertion order produce no events; metadata edits need no order vector', () => {
  const before = current(), after = structuredClone(before);
  after.folders[0] = Object.fromEntries(Object.entries(after.folders[0]).reverse());
  assert.deepEqual(diffAtlasStates(before, after), {});
  after.deferred[0].title = 'Edit'; const patch = diffAtlasStates(before, after);
  assert.equal(patch.deferred.put.length, 1); assert.equal(patch.deferred.order, undefined);
  assert.deepEqual(applyAtlasPatch(before, patch), after);
});

test('damaged identifiers and order fail explicitly rather than silently dropping records', () => {
  assert.throws(() => captureAtlasState({ folders: [], deferred: [link('x', null), link('x', null)] }), /identifiers/);
  assert.throws(() => captureAtlasState({ folders: 'invalid', deferred: [] }), /unavailable/);
  assert.throws(() => applyAtlasPatch(current(), { deferred: { put: [], remove: [], order: ['outside'] } }), /order/);
  assert.throws(() => applyAtlasPatch(current(), { deferred: { put: [link('x', null), link('x', null)], remove: [] } }), /identifiers/);
  assert.throws(() => applyAtlasPatch(current(), { deferred: { put: [], remove: ['unknown'] } }), /removals/);
  assert.throws(() => applyAtlasPatch(current(), { browserTabs: {} }), /damaged/);
});

test('full Atlas restore preserves historical active order and excludes historical archive without mutating either state', () => {
  const before = current(), past = historical(), result = planAtlasRestore(before, past);
  assert.deepEqual(result.target, captureAtlasHistoryState(past)); assert.equal(before.folders.length, 2);
  result.target.deferred[0].title = 'Edit'; assert.equal(past.deferred[0].title, 'Historical title');
  assert.equal(result.changes.folders.removed, 1);
});

test('an existing name or renamed stable identity requires an explicit decision', () => {
  const now = current(), past = historical(); now.folders[0].name = 'Renamed';
  now.folders.push(folder('different', ' WORK '));
  assert.equal(atlasFolderConflicts(now, past.folders[0]).length, 2);
  assert.equal(planAtlasFolderRestore(now, past, 'f').status, 'conflict');
  assert.throws(() => planAtlasFolderRestore(now, past, 'f', { mode: 'replace' }), /Choose the existing/);
  assert.equal(planAtlasFolderRestore(now, past, 'f', { mode: 'replace', targetId: 'different' }).folderId, 'different');
});

test('replacement returns the historical active folder, preserving destination position and unrelated collections', () => {
  const now = current(), past = historical();
  const result = planAtlasFolderRestore(now, past, 'f', { mode: 'replace' });
  assert.equal(result.target.folders[0].color, 'green');
  assert.deepEqual(result.target.folders[1], now.folders[1]);
  assert.deepEqual(result.target.deferred.filter(item => item.folderId === 'f'), captureAtlasHistoryState(past).deferred);
  assert.deepEqual(result.target.deferred.find(item => item.id === 'outside'), now.deferred[2]);
  assert.equal(result.target.deferred.some(item => item.id === 'new'), false);
  assert.equal(now.deferred.some(item => item.id === 'new'), true);
});

test('merge preserves edited/current links and folder fields, and adds only missing active records in order', () => {
  const now = current(), past = historical(), result = planAtlasFolderRestore(now, past, 'f', { mode: 'merge' });
  assert.deepEqual(result.target.folders, now.folders);
  assert.equal(result.target.deferred.find(item => item.id === 'edited').title, 'Current title');
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.target.deferred.slice(3).map(item => item.id), ['old']);
  assert.deepEqual(result.target.deferred.slice(0, 3), now.deferred);
});

test('merge deduplicates only inside the destination and distinguishes query, fragment and active/archive', () => {
  const now = current(), past = historical();
  now.deferred.push(link('same-url', 'f', { url: past.deferred[1].url }));
  past.deferred.push(link('query', 'f', { url: `${past.deferred[1].url}?q=1` }),
    link('fragment', 'f', { url: `${past.deferred[1].url}#x` }), link('archived-url', 'f', { url: past.deferred[1].url, completed: true }),
    link('outside', 'f'));
  const result = planAtlasFolderRestore(now, past, 'f', { mode: 'merge', idFactory: ids() });
  assert.equal(result.skipped, 2);
  assert.ok(result.target.deferred.some(item => item.id === 'query'));
  assert.ok(result.target.deferred.some(item => item.id === 'fragment'));
  assert.equal(result.target.deferred.some(item => item.id === 'archived-url'), false);
  assert.equal(result.target.deferred.filter(item => item.url === 'https://example.test/outside').length, 2);
});

test('copy generates independent ids and prefixed unique name while preserving historical duplicates and original data', () => {
  const now = current(), past = historical(); now.folders.push(folder('copy', 'Restored · Work'));
  past.deferred.push(link('duplicate', 'f', { url: past.deferred[0].url }));
  const result = planAtlasFolderRestore(now, past, 'f', { mode: 'copy', idFactory: ids() });
  assert.equal(result.folderName, 'Restored · Work (2)');
  assert.deepEqual(result.target.folders.slice(0, 3), now.folders);
  assert.deepEqual(result.target.deferred.slice(0, 3), now.deferred);
  const added = result.target.deferred.slice(3);
  assert.equal(added.length, 3); assert.ok(added.every(item => item.id.startsWith('fresh-')));
  assert.ok(added.every(item => item.folderId === result.folderId));
  assert.equal(added.filter(item => item.url === past.deferred[0].url).length, 2);
});

test('locked folder allows adding links and copying, but not replacement or hidden unlock', () => {
  const now = current(); now.folders[0].locked = true;
  assert.throws(() => planAtlasFolderRestore(now, historical(), 'f', { mode: 'replace' }), /Unlock/);
  assert.equal(planAtlasFolderRestore(now, historical(), 'f', { mode: 'merge' }).target.folders[0].locked, true);
  assert.equal(planAtlasFolderRestore(now, historical(), 'f', { mode: 'copy' }).target.folders[0].locked, true);
});

test('record identity collision outside a replaced folder creates a new id without moving that record', () => {
  const now = current(), past = historical(); past.deferred.push(link('outside', 'f'));
  const result = planAtlasFolderRestore(now, past, 'f', { mode: 'replace', idFactory: ids() });
  assert.deepEqual(result.target.deferred.find(item => item.id === 'outside'), now.deferred[2]);
  assert.ok(result.target.deferred.some(item => item.id === 'fresh-1' && item.folderId === 'f'));
});

test('absent folder restores automatically; invalid choice, missing folder and invalid id allocation never mutate source', () => {
  const now = { folders: [], deferred: [] }, past = historical();
  assert.deepEqual(planAtlasFolderRestore(now, past, 'f').target, captureAtlasHistoryState(past));
  assert.throws(() => planAtlasFolderRestore(now, past, 'missing'), /unavailable/);
  assert.throws(() => planAtlasFolderRestore(now, past, 'f', { mode: 'invalid' }), /Choose how/);
  assert.throws(() => planAtlasFolderRestore(current(), past, 'f', { mode: 'copy', idFactory: () => 'f' }), /unique/);
  assert.deepEqual(now, { folders: [], deferred: [] });
});

test('copy names obey the name limit, suffix conflicts and preserve surrogate pairs', () => {
  const name = '😀'.repeat(100), first = restoredFolderName(name, []);
  const second = restoredFolderName(name, [folder('x', first)]);
  assert.ok(first.length <= 120 && second.length <= 120);
  assert.ok(second.endsWith(' (2)'));
  assert.equal(first.isWellFormed(), true); assert.equal(second.isWellFormed(), true);
});

test('multi-folder choices resolve together and never expose a partially restored target', () => {
  const now = current(), past = historical();
  past.folders.push(folder('other', 'Other')); past.deferred.push(link('past-other', 'other'));
  const unresolved = planAtlasSelectionRestore(now, past, { folderIds: ['f', 'other'] }, { folderChoices: { f: { mode: 'merge' } } });
  assert.equal(unresolved.status, 'conflict'); assert.equal(unresolved.target, undefined);
  assert.equal(unresolved.conflicts[0].sourceId, 'other');
  const result = planAtlasSelectionRestore(now, past, { folderIds: ['other', 'f'] }, {
    folderChoices: { f: { mode: 'merge' }, other: { mode: 'copy' } }, idFactory: ids(),
  });
  assert.deepEqual(result.folders.map(plan => plan.sourceId), ['f', 'other']);
  assert.equal(result.target.folders.at(-1).name, 'Restored · Other');
  assert.equal(result.target.deferred.find(item => item.id === 'edited').title, 'Current title');
  assert.equal(now.folders.length, 2); assert.equal(now.deferred.length, 3);
});

test('two historical folders cannot silently replace one destination', () => {
  const past = { folders: [folder('one', 'Work'), folder('two', 'Work')], deferred: [] };
  assert.throws(() => planAtlasSelectionRestore(current(), past, { folderIds: ['one', 'two'] }, {
    folderChoices: { one: { mode: 'replace', targetId: 'f' }, two: { mode: 'merge', targetId: 'f' } },
  }), /same destination/);
});

test('an individual link automatically restores its original missing folder without its neighbours', () => {
  const now = { folders: [], deferred: [] }, past = historical();
  const automatic = planAtlasSelectionRestore(now, past, { linkIds: ['old'] });
  assert.equal(automatic.status, 'ready'); assert.deepEqual(automatic.target.folders, past.folders);
  assert.equal(automatic.target.deferred.length, 1);
  const result = planAtlasSelectionRestore(now, past, { linkIds: ['old'] }, { linkChoices: { old: { parent: 'restore' } } });
  assert.deepEqual(result.target.folders, past.folders); assert.equal(result.target.deferred.length, 1);
  assert.equal(result.target.deferred[0].id, 'old');
  const inbox = planAtlasSelectionRestore(now, past, { linkIds: ['old'] }, { linkChoices: { old: { folderId: null } } });
  assert.equal(inbox.target.folders.length, 0); assert.equal(inbox.target.deferred[0].folderId, null);
});

test('missing parents with a colliding name offer an existing folder or a prefixed empty parent, never all its historical links', () => {
  const now = { folders: [folder('renamed', 'Work')], deferred: [] }, past = historical();
  const firstChoice = planAtlasSelectionRestore(now, past, { linkIds: ['old'] });
  assert.equal(firstChoice.conflicts[0].nameConflict, true);
  assert.equal(firstChoice.target, undefined);
  const unresolved = planAtlasSelectionRestore(now, past, { linkIds: ['old'] }, { linkChoices: { old: { parent: 'restore' } } });
  assert.equal(unresolved.conflicts[0].nameConflict, true);
  const copy = planAtlasSelectionRestore(now, past, { linkIds: ['old', 'edited'] }, {
    linkChoices: { old: { parent: 'copy' }, edited: { parent: 'copy' } }, idFactory: ids(),
  });
  assert.equal(copy.target.folders.length, 2); assert.equal(copy.target.folders[1].name, 'Restored · Work');
  assert.equal(copy.target.deferred.length, 2); assert.equal(copy.target.deferred[0].folderId, copy.target.deferred[1].folderId);
  const existing = planAtlasSelectionRestore(now, past, { linkIds: ['old'] }, { linkChoices: { old: { folderId: 'renamed' } } });
  assert.equal(existing.target.folders.length, 1); assert.equal(existing.target.deferred[0].folderId, 'renamed');
});

test('a modified selected identity needs a choice; keep, replace and copy preserve everything outside that choice', () => {
  const now = current(), past = historical();
  assert.equal(planAtlasSelectionRestore(now, past, { linkIds: ['edited'] }).conflicts[0].type, 'link');
  const keep = planAtlasSelectionRestore(now, past, { linkIds: ['edited'] }, { linkChoices: { edited: { mode: 'keep' } } });
  assert.deepEqual(keep.target, now); assert.equal(keep.skipped, 1);
  const replace = planAtlasSelectionRestore(now, past, { linkIds: ['edited'] }, { linkChoices: { edited: { mode: 'replace' } } });
  assert.deepEqual(replace.target.folders, now.folders); assert.deepEqual(replace.target.deferred.slice(1), now.deferred.slice(1));
  assert.equal(replace.target.deferred[0].title, 'Historical title');
  const copy = planAtlasSelectionRestore(now, past, { linkIds: ['edited'] }, { linkChoices: { edited: { mode: 'copy' } }, idFactory: ids() });
  assert.deepEqual(copy.target.deferred.slice(0, 3), now.deferred); assert.equal(copy.target.deferred.at(-1).id, 'fresh-1');
});

test('selected folder excludes archive and suppresses redundant active child checkboxes', () => {
  const result = planAtlasSelectionRestore(current(), historical(), { folderIds: ['f'], linkIds: ['old'] }, {
    folderChoices: { f: { mode: 'copy' } }, idFactory: ids(),
  });
  assert.equal(result.target.deferred.length, 5); assert.equal(result.target.deferred.filter(item => item.completed).length, 0);
});

test('locked selected identities cannot be replaced; invalid selections and destinations cannot produce a plan', () => {
  const now = current(); now.folders[0].locked = true;
  assert.throws(() => planAtlasSelectionRestore(now, historical(), { linkIds: ['edited'] }, { linkChoices: { edited: { mode: 'replace' } } }), /Unlock/);
  assert.equal(planAtlasSelectionRestore(now, historical(), { linkIds: ['edited'] }, { linkChoices: { edited: { mode: 'copy' } }, idFactory: ids() }).status, 'ready');
  assert.throws(() => planAtlasSelectionRestore(now, historical(), {}), /Choose/);
  assert.throws(() => planAtlasSelectionRestore(now, historical(), { linkIds: ['missing'] }), /unavailable/);
  assert.throws(() => planAtlasSelectionRestore(now, historical(), { linkIds: ['old'] }, { linkChoices: { old: { folderId: 'missing' } } }), /unavailable/);
});

test('imported prototype-like identifiers resolve only explicit own folder/link choices', () => {
  const now = { folders: [folder('__proto__', 'Imported')], deferred: [link('__proto__', '__proto__', { title: 'Current' })] };
  const past = { folders: [folder('__proto__', 'Imported')], deferred: [link('__proto__', '__proto__', { title: 'Historical' })] };
  const inherited = Object.create(Object.fromEntries([['__proto__', { mode: 'replace' }]]));
  assert.equal(planAtlasSelectionRestore(now, past, { folderIds: ['__proto__'] }, { folderChoices: inherited }).status, 'conflict');
  assert.equal(planAtlasSelectionRestore(now, past, { linkIds: ['__proto__'] }, { linkChoices: inherited }).status, 'conflict');
  const folders = planAtlasSelectionRestore(now, past, { folderIds: ['__proto__'] }, {
    folderChoices: Object.fromEntries([['__proto__', { mode: 'copy' }]]), idFactory: ids(),
  });
  assert.equal(folders.status, 'ready'); assert.equal(folders.target.folders[1].name, 'Restored · Imported');
  assert.equal(folders.target.deferred[0].title, 'Current'); assert.equal(folders.target.deferred[1].title, 'Historical');
  const links = planAtlasSelectionRestore(now, past, { linkIds: ['__proto__'] }, {
    linkChoices: Object.fromEntries([['__proto__', { mode: 'copy' }]]), idFactory: ids(),
  });
  assert.equal(links.status, 'ready'); assert.equal(links.target.deferred.length, 2); assert.equal(links.target.deferred[0].title, 'Current');
});
