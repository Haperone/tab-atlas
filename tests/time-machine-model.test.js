import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyHistoryState, captureHistoryState, reduceChromeHistory, diffHistoryStates,
  replayHistory, historyUrl, planHistoryRestore, canUndoHistoryTab } from '../extension/lib/time-machine-model.js';

let serial = 0;
const key = () => `key-${++serial}`;
const tab = (id, options = {}) => ({ id, windowId: 1, index: id - 1, url: `https://example.test/${id}`, title: `Page ${id}`, ...options });
const capture = (tabs, previous) => captureHistoryState([{ id: 1, type: 'normal', tabs }], [], previous, key);

test('capture excludes private windows/tabs and non-web schemes without truncating Unicode URLs', () => {
  const state = captureHistoryState([{ id: 1, type: 'normal', tabs: [tab(1), tab(2,{incognito:true}), tab(3,{url:'javascript:alert(1)'}), tab(4,{url:'https://example.test/путь?x=🌙'})] },
    { id: 2, type: 'normal', incognito:true, tabs:[tab(5)] }, { id:3, type:'popup', tabs:[tab(6)] }], [], undefined, key);
  assert.equal(Object.keys(state.tabs).length, 2);
  assert.equal(Object.keys(state.windows).length, 1);
  assert.equal(historyUrl('file:///tmp/a'), null);
  assert.ok(Object.values(state.tabs).some(t => t.url.includes('🌙')));
});

test('closed Chrome IDs can be reused without resurrecting the previous historical identity', () => {
  const first = capture([tab(1)]), oldKey = Object.keys(first.tabs)[0];
  const removed = reduceChromeHistory(first, {type:'removed',id:1}, key);
  const next = reduceChromeHistory(removed, {type:'created',tab:tab(1,{url:'https://other.test/'})}, key);
  assert.notEqual(Object.keys(next.tabs)[0], oldKey);
  assert.equal(Object.values(first.tabs)[0].url, 'https://example.test/1');
});

test('replay reconstructs each point without mutating the checkpoint', () => {
  const first = capture([tab(1), tab(2)]);
  const second = reduceChromeHistory(first,{type:'updated',tab:tab(1,{url:'https://example.test/new',title:'New'})},key);
  const third = reduceChromeHistory(second,{type:'removed',id:2},key);
  const events = [diffHistoryStates(first,second),diffHistoryStates(second,third)].map(patch => ({patch}));
  assert.deepEqual(replayHistory(first,events), third);
  assert.equal(Object.keys(first.tabs).length, 2);
  assert.deepEqual(diffHistoryStates(third,third), {});
});

test('moves and attachments retain keys and reindex both windows', () => {
  let state = capture([tab(1),tab(2),tab(3)]);
  const firstKey = Object.values(state.tabs).find(t => t.chromeId===1).key;
  state=reduceChromeHistory(state,{type:'moved',id:1,index:2},key);
  assert.deepEqual(Object.values(state.tabs).sort((a,b)=>a.index-b.index).map(t=>t.chromeId),[2,3,1]);
  state=reduceChromeHistory(state,{type:'window-created',window:{id:2,type:'normal'}},key);
  state=reduceChromeHistory(state,{type:'attached',id:1,windowId:2,index:0},key);
  assert.equal(state.tabs[firstKey].chromeId,1);
  assert.equal(state.tabs[firstKey].index,0);
  assert.equal(state.windows[state.tabs[firstKey].windowKey].chromeId,2);
});

test('replacement preserves identity, groups detach cleanly, closing a window preserves prior state', () => {
  let state=capture([tab(1),tab(2)]), firstKey=Object.keys(state.tabs)[0];
  state=reduceChromeHistory(state,{type:'replaced',oldId:1,tab:tab(10,{index:0})},key);
  assert.equal(state.tabs[firstKey].chromeId,10);
  state=reduceChromeHistory(state,{type:'group-updated',group:{id:4,windowId:1,title:'Research',color:'blue'},tabIds:[10,2]},key);
  assert.ok(Object.values(state.tabs).every(t=>t.groupKey));
  const before=state;
  state=reduceChromeHistory(state,{type:'group-removed',id:4},key);
  assert.ok(Object.values(state.tabs).every(t=>!t.groupKey));
  state=reduceChromeHistory(state,{type:'window-removed',id:1},key);
  assert.equal(Object.keys(state.tabs).length,0);
  assert.equal(Object.keys(before.tabs).length,2);
});

test('confirmed navigation to a blocked scheme removes a formerly restorable tab', () => {
  const first=capture([tab(1)]);
  const next=reduceChromeHistory(first,{type:'updated',tab:tab(1,{url:'chrome://settings/'})},key);
  assert.equal(Object.keys(next.tabs).length,0);
});

test('restore planning deduplicates exact addresses but preserves query and fragment differences', () => {
  const state=capture([tab(1),tab(2,{url:tab(1).url}),tab(3,{url:`${tab(1).url}#section`}),tab(4,{url:`${tab(1).url}?q=1`})]);
  const plan=planHistoryRestore(state,Object.keys(state.tabs),[tab(8,{url:tab(1).url})]);
  assert.equal(plan.tabs.length,2);
  assert.equal(plan.skipped.length,2);
  assert.equal(plan.windowCount,1);
});

test('Undo never owns an existing, private, moved, navigated, repinned or changed tab', () => {
  const owned={id:9,windowId:3,url:'https://example.test/',pinned:false};
  assert.equal(canUndoHistoryTab(owned,{...owned}),true);
  for (const change of [{id:8},{incognito:true},{windowId:4},{url:'https://else.test/'},{pinned:true}]) {
    assert.equal(canUndoHistoryTab(owned,{...owned,...change}),false);
  }
  assert.equal(canUndoHistoryTab({...owned,changed:true},owned),false);
  assert.deepEqual(emptyHistoryState(),{tabs:{},windows:{},groups:{}});
});

test('internal tab creation shifts physical positions and internal navigation keeps its slot',()=>{
  const first=capture([tab(1),tab(2),tab(3)]);
  const created=reduceChromeHistory(first,{type:'created',tab:tab(9,{index:1,url:'chrome://newtab/'})},key);
  assert.deepEqual(Object.values(created.tabs).map(t=>t.index),[0,2,3]);
  const navigated=reduceChromeHistory(created,{type:'updated',tab:tab(2,{index:2,url:'chrome://settings/'})},key);
  assert.equal(Object.values(navigated.tabs).find(t=>t.chromeId===3).index,3);
  assert.equal(Object.values(navigated.tabs).find(t=>t.chromeId===2),undefined);
});

test('a refreshed native group clears former members without dropping other group metadata',()=>{
  const first=captureHistoryState([{id:1,type:'normal',tabs:[tab(1,{groupId:4}),tab(2,{groupId:4}),tab(3)]}],
    [{id:4,windowId:1,title:'Research',color:'green',collapsed:true}],undefined,key);
  const next=reduceChromeHistory(first,{type:'group-updated',group:{id:4,windowId:1,title:'Renamed',color:'blue',collapsed:false},tabIds:[2]},key);
  assert.equal(Object.values(next.tabs).find(t=>t.chromeId===1).groupKey,null);
  const member=Object.values(next.tabs).find(t=>t.chromeId===2);
  assert.equal(next.groups[member.groupKey].title,'Renamed');assert.equal(next.groups[member.groupKey].collapsed,false);
});
