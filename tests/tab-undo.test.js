import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotUndoTab, restoreUndoTabRecord } from '../extension/lib/tab-undo.js';

function fixture({ existingGroup = true, windowExists = true } = {}) {
  const calls = { create:[], group:[], update:[] };
  const chrome = {
    windows:{ getAll:async()=> windowExists ? [{id:5}] : [{id:9}] },
    tabs:{ create:async options=>{ calls.create.push(options); return {id:calls.create.length+100}; },
      group:async options=>{ calls.group.push(options); return options.groupId ?? 88; } },
    tabGroups:{ get:async id=>{ if(!existingGroup)throw new Error('Group closed');return {id}; },
      update:async(id,metadata)=>{ calls.update.push({id,metadata}); } },
  };
  const snapshot = snapshotUndoTab({url:'https://example.com',windowId:5,index:3,groupId:7}, {title:'Research',color:'blue',collapsed:true});
  return {chrome,calls,snapshot};
}

test('Undo returns a tab to its original window, position and existing group', async()=>{
  const {chrome,calls,snapshot} = fixture();
  await restoreUndoTabRecord(chrome,snapshot);
  assert.deepEqual(calls.create,[{url:'https://example.com',active:false,pinned:false,windowId:5,index:3}]);
  assert.deepEqual(calls.group,[{groupId:7,tabIds:[101]}]);
  assert.equal(calls.update.length,0); // Respect current metadata of a surviving group.
});
test('Undo recreates one closed group with its name, color and collapsed state', async()=>{
  const {chrome,calls,snapshot} = fixture({existingGroup:false});
  const second = {...snapshot,url:'https://example.com/second'};
  const groups = new Map();
  await restoreUndoTabRecord(chrome,snapshot,groups);
  await restoreUndoTabRecord(chrome,second,groups);
  assert.equal(calls.group.filter(options=>options.groupId==null).length,1);
  assert.equal(calls.group.at(-1).groupId,88);
  assert.deepEqual(calls.update.at(-1),{id:88,metadata:{title:'Research',color:'blue',collapsed:true}});
});
test('Undo falls back to the current window when the original window closed', async()=>{
  const {chrome,calls,snapshot} = fixture({windowExists:false});
  delete snapshot.groupId;
  await restoreUndoTabRecord(chrome,snapshot);
  assert.equal('windowId' in calls.create[0],false);
  assert.equal('index' in calls.create[0],false);
});
test('Retry after group assignment fails reuses the created tab', async()=>{
  const {chrome,calls,snapshot} = fixture();
  const group = chrome.tabs.group;
  chrome.tabs.group=async()=>{throw new Error('Assignment rejected');};
  await assert.rejects(restoreUndoTabRecord(chrome,snapshot));
  chrome.tabs.group=group;
  await restoreUndoTabRecord(chrome,snapshot);
  assert.equal(calls.create.length,1);
  assert.deepEqual(calls.group,[{groupId:7,tabIds:[101]}]);
});
test('Retry after recreated group metadata fails does not recreate the group or tab', async()=>{
  const {chrome,calls,snapshot} = fixture({existingGroup:false});
  const update=chrome.tabGroups.update;
  chrome.tabGroups.update=async()=>{throw new Error('Metadata rejected');};
  await assert.rejects(restoreUndoTabRecord(chrome,snapshot));
  chrome.tabGroups.update=update;
  await restoreUndoTabRecord(chrome,snapshot);
  assert.equal(calls.create.length,1);
  assert.equal(calls.group.filter(options=>options.groupId==null).length,1);
  assert.equal(calls.update[0].id,88);
});
test('Pinned Undo restores pinning on creation and never assigns a native group', async()=>{
  const {chrome,calls,snapshot} = fixture();
  snapshot.pinned=true;
  await restoreUndoTabRecord(chrome,snapshot);
  assert.equal(calls.create[0].pinned,true);
  assert.equal(calls.group.length,0);
});
