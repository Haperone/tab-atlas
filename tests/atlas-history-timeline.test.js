import test from 'node:test';
import assert from 'node:assert/strict';
import { historyWindow, zoomHistoryWindow, historyTicks } from '../extension/lib/atlas-history-timeline.js';

test('zoom preserves the cursor anchor until a history boundary is reached', () => {
  const next = zoomHistoryWindow({ start: 0, end: 10000 }, .25, 3000, 0, 10000);
  assert.deepEqual(next, { start: 2250, end: 4750 });
  assert.equal((3000 - next.start) / (next.end - next.start), .3);
  assert.deepEqual(zoomHistoryWindow(next, 4, 3000, 0, 10000), { start: 0, end: 10000 });
});
test('pan preserves the visible span and stops at either retention boundary', () => {
  assert.deepEqual(historyWindow(-2000, 1000, 0, 10000), { start: 0, end: 3000 });
  assert.deepEqual(historyWindow(9000, 12000, 0, 10000), { start: 7000, end: 10000 });
  assert.deepEqual(historyWindow(0, 5000, 100, 1000), { start: 100, end: 1000 });
});
test('one snapshot and a complete subsecond history remain available without inventing out-of-bounds dates', () => {
  assert.deepEqual(zoomHistoryWindow({ start: 100, end: 100 }, .25, 100, 100, 100), { start: 100, end: 100 });
  assert.deepEqual(zoomHistoryWindow({ start: 0, end: 2 }, .01, 1, 0, 2), { start: 0, end: 2 });
  assert(historyTicks(101, 102, 800).every(tick => tick.label && tick.unit === 'second'));
});

test('zoom and cluster windows stop at one second while preserving the anchor or requested centre', () => {
  const next = zoomHistoryWindow({ start: 0, end: 10000 }, .001, 3000, 0, 10000);
  assert.deepEqual(next, { start: 2700, end: 3700 });
  assert.deepEqual(zoomHistoryWindow(next, .25, 3000, 0, 10000), next);
  assert.deepEqual(historyWindow(3000, 3020, 0, 10000), { start: 2510, end: 3510 });
  assert.deepEqual(historyWindow(-10, 10, 0, 10000), { start: 0, end: 1000 });
});

test('the closest calendar anchors are whole seconds, never fractional seconds', () => {
  const ticks = historyTicks(1000, 2000, 1200);
  assert.equal(ticks.length, 2);
  assert(ticks.every(tick => tick.unit === 'second' && tick.time % 1000 === 0 && tick.end - tick.time === 1000));
});
test('multi-year ruler exposes bounded calendar month anchors rather than fractions of elapsed years', () => {
  const start = new Date(2024, 0, 1).getTime(), end = new Date(2026, 0, 1).getTime();
  const ticks = historyTicks(start, end, 1200);
  assert(ticks.length >= 5 && ticks.length <= 16);
  assert(ticks.every(tick => tick.unit === 'month' && new Date(tick.time).getDate() === 1));
  assert(ticks.some(tick => new Date(tick.time).getFullYear() === 2025));
});
test('month ticks respect leap-year February and the real length of each month', () => {
  const ticks = historyTicks(new Date(2024, 0, 1).getTime(), new Date(2024, 4, 1).getTime(), 600);
  const february = ticks.find(tick => new Date(tick.time).getMonth() === 1);
  assert.equal(new Date(february.end).getMonth(), 2);
  assert.equal(new Date(february.end).getDate(), 1);
});
test('day ticks stay at local midnight over daylight-saving transitions', () => {
  const ticks = historyTicks(new Date(2026, 2, 27).getTime(), new Date(2026, 3, 1).getTime(), 800);
  assert(ticks.length >= 4);
  assert(ticks.every(tick => new Date(tick.time).getHours() === 0));
  assert(ticks.every((tick, index) => !index || tick.time > ticks[index - 1].time));
});
test('a narrow one-year ruler still exposes month anchors without repeating the year row', () => {
  const ticks = historyTicks(new Date(2025, 0, 1).getTime(), new Date(2026, 0, 1).getTime(), 232);
  assert(ticks.length >= 2 && ticks.every(tick => tick.unit === 'month'));
});
