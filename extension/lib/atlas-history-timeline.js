const DAY = 86400000;
const MIN_WINDOW = 1000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const formats = new Map();
const format = (time, options) => { const key = JSON.stringify(options); if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat(undefined, options)); return formats.get(key).format(time); };
const fullDate = time => format(time, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'shortOffset', ...(time % 1000 ? { fractionalSecondDigits: 3 } : {}) });

export function historyWindow(start, end, oldest, latest) {
  const requestedSpan = Math.max(0, end - start), span = Math.min(Math.max(MIN_WINDOW, requestedSpan), latest - oldest);
  const left = clamp(start - Math.max(0, span - requestedSpan) / 2, oldest, latest - span);
  return { start: left, end: left + span };
}
export function zoomHistoryWindow(window, factor, anchor, oldest, latest) {
  const span = window.end - window.start, position = span ? clamp((anchor - window.start) / span, 0, 1) : .5;
  const nextSpan = clamp(span * factor, Math.min(MIN_WINDOW, latest - oldest), latest - oldest);
  return historyWindow(anchor - nextSpan * position, anchor + nextSpan * (1 - position), oldest, latest);
}

// Calendar intervals preserve month/year boundaries and local DST transitions.
export function historyTicks(start, end, width = 800) {
  const intervals = [['second', 1, 1000], ['second', 10, 10000], ['minute', 1, 60000], ['minute', 10, 600000], ['hour', 1, 3600000], ['hour', 6, 21600000], ['day', 1, DAY], ['day', 7, DAY * 7], ['month', 1, DAY * 30], ['month', 3, DAY * 90], ['month', 6, DAY * 183], ['year', 1, DAY * 365], ['year', 5, DAY * 1826], ['year', 10, DAY * 3653]];
  const [unit, step] = intervals.find(([, , duration]) => (end - start) / duration <= Math.max(2, Math.floor(width / 90))) || intervals.at(-1);
  const floor = new Date(start);
  if (unit === 'year') { floor.setMonth(0, 1); floor.setHours(0, 0, 0, 0); floor.setFullYear(Math.floor(floor.getFullYear() / step) * step); }
  else if (unit === 'month') { floor.setDate(1); floor.setHours(0, 0, 0, 0); floor.setMonth(Math.floor(floor.getMonth() / step) * step); }
  else if (unit === 'day') floor.setHours(0, 0, 0, 0);
  else if (unit === 'hour') { floor.setMinutes(0, 0, 0); floor.setHours(Math.floor(floor.getHours() / step) * step); }
  else if (unit === 'minute') { floor.setSeconds(0, 0); floor.setMinutes(Math.floor(floor.getMinutes() / step) * step); }
  else if (unit === 'second') { floor.setMilliseconds(0); floor.setSeconds(Math.floor(floor.getSeconds() / step) * step); }
  const advance = date => {
    if (unit === 'year') date.setFullYear(date.getFullYear() + step);
    else if (unit === 'month') date.setMonth(date.getMonth() + step);
    else if (unit === 'day') date.setDate(date.getDate() + step);
    else date.setTime(date.getTime() + intervals.find(item => item[0] === unit && item[1] === step)[2]);
  };
  const ticks = [];
  for (let i = 0; floor.getTime() <= end && i < 100; i++, advance(floor)) {
    const time = floor.getTime(); if (time < start) continue;
    const next = new Date(time); advance(next);
    const label = unit === 'year' ? String(floor.getFullYear()) : unit === 'month' ? format(time, { month: 'short' })
      : unit === 'day' ? format(time, { month: 'short', day: 'numeric' })
      : format(time, { hour: '2-digit', minute: '2-digit', ...(unit === 'second' ? { second: '2-digit' } : {}) });
    ticks.push({ time, end: next.getTime(), label, unit });
  }
  if (!ticks.length) ticks.push({ time: start, end: start + MIN_WINDOW, label: format(start, { hour: '2-digit', minute: '2-digit', second: '2-digit' }), unit: 'second' });
  return ticks;
}

export function createAtlasTimeline(root, { load, nearest, seek, step, announce, report }) {
  root.innerHTML = `<div class="tm-nav-toolbar"><span class="tm-nav-period"></span><div class="tm-nav-actions">
    <button type="button" data-nav="pan-back" aria-label="Show earlier period" title="Earlier period" hidden>‹</button>
    <button type="button" data-nav="pan-forward" aria-label="Show later period" title="Later period" hidden>›</button>
    <button type="button" data-nav="zoom-out" aria-label="Zoom out" title="Zoom out (−)">−</button>
    <button type="button" data-nav="zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>
    <button type="button" data-nav="fit" hidden>All history</button></div></div>
    <div class="tm-ruler" aria-describedby="tmTimelineHelp"><div class="tm-year-bands"></div><div class="tm-axis-ticks"></div>
      <div class="tm-ruler-points"></div><span class="tm-playhead" aria-hidden="true"></span>
      <label class="visually-hidden" for="tmRange">Recorded moment</label><input id="tmRange" type="range" min="0" max="1000" step="any" value="1000" aria-describedby="tmTimelineHelp">
      <div class="tm-ruler-hover" role="tooltip" hidden></div></div>
    <div class="tm-nav-caption"><span class="tm-nav-total"></span><span class="tm-nav-gesture">Scroll to zoom · Drag to move</span></div>
    <p class="visually-hidden" id="tmTimelineHelp">Zoom to inspect nearby snapshots, down to one second. Drag the ruler to move the period. Arrow keys choose the previous or next snapshot, including snapshots within the same second. Plus and minus zoom. Page Up and Page Down move the period. Home and End choose the oldest and latest snapshot.</p>
    <div class="tm-time-bounds"><span class="tm-oldest"></span><span class="tm-newest"></span></div>`;
  const find = selector => root.querySelector(selector), ruler = find('.tm-ruler'), range = find('#tmRange');
  let bounds = null, window = null, selected = null, disabled = true, buckets = [], key = '', generation = 0, choiceVersion = 0, timer, drag, frame, suppressClick = false, width = 800, revision = null;
  const span = () => Math.max(1, window.end - window.start);
  const position = time => window.end === window.start ? 50 : (time - window.start) / span() * 100;
  const timeAt = clientX => { const box = ruler.getBoundingClientRect(); return window.start + clamp((clientX - box.left) / box.width, 0, 1) * (window.end - window.start); };
  const makeButton = (text, className, title) => { const value = document.createElement('button'); value.type = 'button'; value.textContent = text; value.className = className; value.title = title; return value; };
  const run = promise => void Promise.resolve(promise).catch(report);
  function render() {
    if (!window) return;
    const focused = root.contains(document.activeElement) && document.activeElement.matches('.tm-axis-label,.tm-year-label,.tm-moment') ? document.activeElement : null;
    root.dataset.start = window.start; root.dataset.end = window.end;
    const full = window.start === bounds.oldest && window.end === bounds.latest;
    root.dataset.zoomed = String(!full);
    const periodOptions = span() > DAY * 60 ? { month: 'short', year: 'numeric' } : span() > DAY ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(span() <= 60000 ? { second: '2-digit' } : {}) };
    find('.tm-nav-period').textContent = window.start === window.end ? fullDate(window.start) : `${format(window.start, periodOptions)} – ${format(window.end, periodOptions)}`;
    find('.tm-oldest').textContent = fullDate(window.start); find('.tm-newest').textContent = fullDate(window.end);
    for (const target of root.querySelectorAll('[data-nav]')) {
      const action = target.dataset.nav; target.hidden = ['pan-back', 'pan-forward', 'fit'].includes(action) && full;
      target.disabled = disabled || (action === 'zoom-out' && full) || (action === 'zoom-in' && window.end - window.start <= MIN_WINDOW)
        || (action === 'pan-back' && window.start <= bounds.oldest) || (action === 'pan-forward' && window.end >= bounds.latest);
      if ((target.hidden || target.disabled) && document.activeElement === target && !disabled) range.focus({ preventScroll: true });
    }
    range.disabled = disabled; range.value = clamp(position(selected ?? window.end) * 10, 0, 1000);
    const head = find('.tm-playhead'); head.hidden = selected == null || selected < window.start || selected > window.end;
    range.dataset.outside = String(head.hidden);
    range.setAttribute('aria-valuetext', selected != null ? `${head.hidden ? 'Outside visible period · ' : ''}${fullDate(selected)}` : 'Choose a recorded moment');
    head.style.left = `${clamp(position(selected), 0, 100)}%`;
    const ticks = find('.tm-axis-ticks'); ticks.replaceChildren();
    for (const tick of historyTicks(window.start, window.end, width)) {
      if (tick.unit === 'year') continue; // Year navigation is already in the row above.
      const target = makeButton(tick.label, 'tm-axis-label', `Zoom to ${fullDate(tick.time)}`);
      const date = new Date(tick.time);
      const end = tick.unit === 'year' ? new Date(date.getFullYear() + 1, 0, 1).getTime()
        : tick.unit === 'month' ? new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
        : tick.unit === 'day' ? new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
        : tick.unit === 'hour' ? tick.time + 3600000 : tick.unit === 'minute' ? tick.time + 60000 : tick.time + 1000;
      target.style.left = `${clamp(position(tick.time), 3, 97)}%`; target.dataset.start = tick.time; target.dataset.end = end; target.disabled = disabled; ticks.append(target);
    }
    const years = find('.tm-year-bands'); years.replaceChildren();
    if (span() >= DAY * 60) {
      const firstYear = new Date(window.start).getFullYear(), lastYear = new Date(Math.max(window.start, window.end - 1)).getFullYear();
      let interval = Math.max(1, Math.ceil((lastYear - firstYear + 1) / Math.max(1, Math.floor(width / 64))));
      if (interval > 1) interval = Math.ceil((lastYear - firstYear + 1) / Math.max(1, Math.floor(width / 100)));
      for (let year = firstYear; year <= lastYear; year += interval) {
        const start = new Date(year, 0, 1).getTime(), end = new Date(year + interval, 0, 1).getTime();
        const target = makeButton(interval === 1 ? String(year) : `${year}–${year + interval - 1}`, 'tm-year-label', `Zoom to ${year}${interval > 1 ? '–' + (year + interval - 1) : ''}`);
        target.style.left = `${position((Math.max(start, window.start) + Math.min(end, window.end)) / 2)}%`;
        target.dataset.start = start; target.dataset.end = end; target.disabled = disabled; years.append(target);
      }
    } else {
      const middle = new Date((window.start + window.end) / 2), start = new Date(middle.getFullYear(), middle.getMonth(), 1).getTime(), end = new Date(middle.getFullYear(), middle.getMonth() + 1, 1).getTime();
      const target = makeButton(format(start, { month: 'long', year: 'numeric' }), 'tm-year-label', `Show ${format(start, { month: 'long', year: 'numeric' })}`);
      target.style.left = '50%'; target.dataset.start = start; target.dataset.end = end; target.disabled = disabled; years.append(target);
    }
    drawPoints();
    if (focused && !focused.isConnected && !disabled) {
      const replacement = [...root.querySelectorAll('button')].find(target => !target.disabled && target.className === focused.className && target.dataset.start === focused.dataset.start && target.dataset.time === focused.dataset.time);
      (replacement || range).focus({ preventScroll: true });
    }
  }
  function drawPoints() {
    const holder = find('.tm-ruler-points'), focused = holder.contains(document.activeElement), focusedTime = focused ? Number(document.activeElement.dataset.time) : null;
    holder.replaceChildren();
    const visible = [];
    for (const bucket of buckets.filter(bucket => bucket.last >= window.start && bucket.first <= window.end)) {
      const previous = visible.at(-1);
      if (previous && ((bucket.first + bucket.last - previous.first - previous.last) / 2) / span() * width < 44) {
        previous.last = bucket.last; previous.count += bucket.count;
      } else visible.push({ ...bucket });
    }
    const active = visible.findIndex(bucket => selected >= bucket.first && selected <= bucket.last);
    for (const [index, bucket] of visible.entries()) {
      const title = bucket.count === 1 ? `Open snapshot: ${fullDate(bucket.first)}` : window.end - window.start <= MIN_WINDOW
        ? `${bucket.count} snapshots in this second. Use Earlier, Later or the arrow keys to choose a snapshot.`
        : `Zoom into ${bucket.count} snapshots: ${fullDate(bucket.first)} – ${fullDate(bucket.last)}`;
      const target = makeButton('', `tm-moment${bucket.count > 1 ? ' tm-moment-cluster' : ''}`, title); target.setAttribute('aria-label', title);
      target.style.setProperty('--tm-density-height', `${Math.min(18, 8 + Math.log2(bucket.count) * 1.5)}px`);
      target.style.left = `${clamp(position((bucket.first + bucket.last) / 2), 0, 100)}%`;
      target.dataset.time = bucket.first; target.dataset.last = bucket.last; target.dataset.count = bucket.count; target.disabled = disabled;
      target.tabIndex = index === (active < 0 ? 0 : active) ? 0 : -1;
      if (selected >= bucket.first && selected <= bucket.last) target.setAttribute('aria-current', 'true');
      holder.append(target);
    }
    if (focused) (holder.querySelector(`[data-time="${focusedTime}"]`) || range).focus({ preventScroll: true });
  }
  function requestPoints(delay = 0) {
    clearTimeout(timer); const ownGeneration = ++generation;
    if (!window || disabled) { root.setAttribute('aria-busy', 'false'); return; }
    const request = { start: window.start, end: window.end, bins: Math.max(1, Math.min(200, Math.floor(width / 48))) };
    const nextKey = `${request.start}:${request.end}:${request.bins}:${revision}`;
    if (nextKey === key) { root.setAttribute('aria-busy', 'false'); return; }
    root.setAttribute('aria-busy', 'true');
    timer = setTimeout(async () => {
      try {
        const response = await load(request); if (ownGeneration !== generation) return;
        key = nextKey; buckets = response.buckets; drawPoints();
        find('.tm-nav-total').textContent = response.total ? `${response.total} snapshot${response.total === 1 ? '' : 's'}` : 'No snapshots in this period';
      } catch (error) { if (ownGeneration === generation) report(error); }
      finally { if (ownGeneration === generation) root.setAttribute('aria-busy', 'false'); }
    }, delay);
  }
  function changeWindow(next, delay = 0) {
    choiceVersion++; delete root.dataset.choosing;
    window = historyWindow(next.start, next.end, bounds.oldest, bounds.latest); render(); requestPoints(delay);
  }
  function zoom(factor, anchor = selected >= window.start && selected <= window.end ? selected : (window.start + window.end) / 2, delay = 0) {
    changeWindow(zoomHistoryWindow(window, factor, anchor, bounds.oldest, bounds.latest), delay);
  }
  async function choose(time) {
    if (disabled) return;
    // Indexed neighbour lookup selects a real moment without reconstructing gaps.
    const ownChoice = ++choiceVersion; root.dataset.choosing = 'true';
    try { const chosen = await nearest(Math.round(time)); if (chosen != null && ownChoice === choiceVersion && !disabled) await seek(chosen); }
    catch (error) { if (ownChoice === choiceVersion) report(error); }
    finally { if (ownChoice === choiceVersion) { delete root.dataset.choosing; render(); } }
  }
  async function moveStep(direction) {
    const ownChoice = ++choiceVersion; root.dataset.choosing = 'true';
    try { await step(direction); }
    finally { if (ownChoice === choiceVersion) delete root.dataset.choosing; }
  }
  function activatePoint(target) {
    if (Number(target.dataset.count) === 1) { choiceVersion++; delete root.dataset.choosing; run(seek(Number(target.dataset.time))); }
    else if (window.end - window.start <= MIN_WINDOW) { range.focus({ preventScroll: true }); announce(target.title); }
    else { const first = Number(target.dataset.time), last = Number(target.dataset.last), padding = Math.max(1, (last - first) * .15); changeWindow({ start: first - padding, end: last + padding }); }
  }
  root.addEventListener('click', event => {
    if (suppressClick && event.detail) { event.preventDefault(); return; }
    const target = event.target.closest('button'); if (!target || target.disabled || disabled) return;
    const action = target.dataset.nav;
    if (action === 'zoom-in' || action === 'zoom-out') zoom(action === 'zoom-in' ? .25 : 4);
    else if (action === 'fit') changeWindow({ start: bounds.oldest, end: bounds.latest });
    else if (action === 'pan-back' || action === 'pan-forward') { const distance = span() * .7 * (action === 'pan-back' ? -1 : 1); changeWindow({ start: window.start + distance, end: window.end + distance }); }
    else if (target.dataset.start) changeWindow({ start: Number(target.dataset.start), end: Number(target.dataset.end) });
    else if (target.dataset.time) activatePoint(target);
    if (action) announce(find('.tm-nav-period').textContent);
  });
  ruler.addEventListener('wheel', event => {
    if (disabled || event.ctrlKey || !event.deltaY && !event.deltaX) return;
    event.preventDefault();
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const distance = (event.deltaX || event.deltaY) / width * span(); changeWindow({ start: window.start + distance, end: window.end + distance }, 120);
    } else zoom(Math.exp(clamp(event.deltaY, -100, 100) * .008), timeAt(event.clientX), 120);
  }, { passive: false });
  ruler.addEventListener('pointerdown', event => {
    const target = event.target.closest('button');
    if (disabled || event.button !== 0 || event.target.closest('input') || target && !target.matches('.tm-moment')) return;
    drag = { id: event.pointerId, x: event.clientX, window: { ...window }, moved: false, target }; ruler.setPointerCapture(event.pointerId);
  });
  ruler.addEventListener('pointermove', event => {
    if (disabled || !window) return;
    if (drag?.id === event.pointerId) {
      const distance = event.clientX - drag.x; if (Math.abs(distance) > 6) drag.moved = true;
      if (drag.moved) {
        const offset = -distance / width * (drag.window.end - drag.window.start);
        window = historyWindow(drag.window.start + offset, drag.window.end + offset, bounds.oldest, bounds.latest);
        ruler.dataset.dragging = 'true';
        if (!frame) frame = requestAnimationFrame(() => { frame = null; render(); });
      }
      return;
    }
    const tooltip = find('.tm-ruler-hover'), point = event.target.closest('.tm-moment'); tooltip.hidden = false;
    tooltip.textContent = point ? `${point.dataset.count} snapshot${Number(point.dataset.count) === 1 ? '' : 's'} · ${fullDate(Number(point.dataset.time))}` : fullDate(timeAt(event.clientX));
    const half = tooltip.offsetWidth / 2;
    tooltip.style.left = `${clamp(position(timeAt(event.clientX)) / 100 * width, half, Math.max(half, width - half))}px`;
  });
  const endDrag = (event, cancel = false) => {
    if (drag?.id !== event.pointerId) return;
    const { moved, target } = drag; drag = null; delete ruler.dataset.dragging;
    if (ruler.hasPointerCapture(event.pointerId)) ruler.releasePointerCapture(event.pointerId);
    if (frame) { cancelAnimationFrame(frame); frame = null; } render(); requestPoints();
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    if (!moved && !cancel) { if (target) activatePoint(target); else run(choose(timeAt(event.clientX))); }
  };
  ruler.addEventListener('pointerup', event => endDrag(event)); ruler.addEventListener('pointercancel', event => endDrag(event, true));
  ruler.addEventListener('pointerleave', () => { find('.tm-ruler-hover').hidden = true; });
  ruler.addEventListener('focusin', event => {
    const point = event.target.closest('.tm-moment'); if (!point) return;
    const tooltip = find('.tm-ruler-hover'); tooltip.hidden = false;
    tooltip.textContent = `${point.dataset.count} snapshot${Number(point.dataset.count) === 1 ? '' : 's'} · ${fullDate(Number(point.dataset.time))}`;
    const half = tooltip.offsetWidth / 2;
    tooltip.style.left = `${clamp(parseFloat(point.style.left) / 100 * width, half, Math.max(half, width - half))}px`;
  });
  ruler.addEventListener('focusout', () => { find('.tm-ruler-hover').hidden = true; });
  range.addEventListener('input', () => { const time = window.start + (window.end - window.start) * Number(range.value) / 1000; range.dataset.outside = 'false'; find('.tm-playhead').hidden = false; find('.tm-playhead').style.left = `${Number(range.value) / 10}%`; range.setAttribute('aria-valuetext', fullDate(time)); });
  range.addEventListener('change', () => run(choose(window.start + (window.end - window.start) * Number(range.value) / 1000)));
  root.addEventListener('keydown', event => {
    if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest('.tm-moment') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); const points = [...find('.tm-ruler-points').children], index = points.indexOf(event.target), next = points[clamp(index + (event.key === 'ArrowLeft' ? -1 : 1), 0, points.length - 1)];
      for (const point of points) point.tabIndex = point === next ? 0 : -1; next?.focus(); return;
    }
    if (['+', '=', '-', 'PageUp', 'PageDown'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '+' || event.key === '=' || event.key === '-') zoom(event.key === '-' ? 4 : .25);
      else { const offset = span() * .7 * (event.key === 'PageUp' ? -1 : 1); changeWindow({ start: window.start + offset, end: window.end + offset }); }
      announce(find('.tm-nav-period').textContent);
    } else if (event.target === range && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); run(event.key === 'Home' || event.key === 'End' ? seek(event.key === 'Home' ? bounds.oldest : bounds.latest) : moveStep(['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1));
    }
  });
  new ResizeObserver(entries => { width = Math.max(120, entries[0].contentRect.width); if (window) { render(); requestPoints(60); } }).observe(ruler);
  return {
    update({ oldest, latest, time, unavailable, version }) {
      disabled = unavailable; revision = version;
      if (oldest == null || latest == null) { window = null; clearTimeout(timer); generation++; root.setAttribute('aria-busy', 'false'); return; }
      const full = !window || window.start === bounds?.oldest && window.end === bounds?.latest;
      bounds = { oldest, latest };
      window = full ? { start: oldest, end: latest } : historyWindow(window.start, window.end, oldest, latest);
      if (time != null && time !== selected && (time < window.start || time > window.end)) {
        const half = span() / 2; window = historyWindow(time - half, time + half, oldest, latest);
      }
      selected = time; render(); requestPoints();
    },
    reset() { clearTimeout(timer); generation++; choiceVersion++; delete root.dataset.choosing; disabled = true; if (frame) cancelAnimationFrame(frame); if (drag && ruler.hasPointerCapture(drag.id)) ruler.releasePointerCapture(drag.id); frame = null; drag = null; delete ruler.dataset.dragging; find('.tm-ruler-hover').hidden = true; window = bounds = null; selected = null; buckets = []; key = ''; root.setAttribute('aria-busy', 'false'); },
    invalidate() { key = ''; },
  };
}
