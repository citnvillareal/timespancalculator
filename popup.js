'use strict';

const STORAGE_KEY  = 'tsc_v3_entries';
const WEBHOOK_KEY  = 'tsc_webhook';
const SCHEDULE_KEY = 'tsc_schedule';
let entries = [];
let nextId = 1;
let tickId = null;
let webhookUrl = '';
let schedule = { enabled: false, type: 'recurring', time: '17:00', days: [1,2,3,4,5], date: '' };

const storage = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local : null;

// ── Persistence ────────────────────────────────────────────────

function loadEntries(cb) {
  if (storage) {
    storage.get(STORAGE_KEY, result => {
      const saved = result[STORAGE_KEY];
      if (Array.isArray(saved) && saved.length > 0) {
        entries = saved;
        entries.forEach(e => { if (e.dayOffset === undefined) e.dayOffset = autoEndDayOffset(e); });
        nextId = Math.max(...entries.map(e => e.id)) + 1;
      } else {
        entries = [makeEntry()];
      }
      cb();
    });
  } else {
    entries = [makeEntry()];
    cb();
  }
}

function save() {
  if (storage) storage.set({ [STORAGE_KEY]: entries });
}

function loadWebhook(cb) {
  if (storage) {
    storage.get(WEBHOOK_KEY, result => { webhookUrl = result[WEBHOOK_KEY] || ''; cb(); });
  } else {
    try { webhookUrl = localStorage.getItem(WEBHOOK_KEY) || ''; } catch(_) {}
    cb();
  }
}

function saveWebhook(url) {
  webhookUrl = url;
  if (storage) storage.set({ [WEBHOOK_KEY]: url });
  else try { localStorage.setItem(WEBHOOK_KEY, url); } catch(_) {}
}

function loadSchedule(cb) {
  if (storage) {
    storage.get(SCHEDULE_KEY, result => {
      if (result[SCHEDULE_KEY]) schedule = { ...schedule, ...result[SCHEDULE_KEY] };
      cb();
    });
  } else {
    try {
      const s = localStorage.getItem(SCHEDULE_KEY);
      if (s) schedule = { ...schedule, ...JSON.parse(s) };
    } catch(_) {}
    cb();
  }
}

function saveSchedule() {
  if (storage) storage.set({ [SCHEDULE_KEY]: schedule });
  else try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule)); } catch(_) {}
}

function nextOccurrenceMs(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const t = new Date();
  t.setSeconds(0, 0);
  t.setHours(h, m);
  if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

function applyAlarms() {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  chrome.alarms.clear('tsc_recurring');
  chrome.alarms.clear('tsc_once');
  if (!schedule.enabled || !webhookUrl) return;
  if (schedule.type === 'recurring') {
    const when = nextOccurrenceMs(schedule.time);
    if (when) chrome.alarms.create('tsc_recurring', { when, periodInMinutes: 1440 });
  } else {
    if (!schedule.date || !schedule.time) return;
    const when = new Date(schedule.date + 'T' + schedule.time).getTime();
    if (when > Date.now()) chrome.alarms.create('tsc_once', { when });
  }
}

// ── Entry model ────────────────────────────────────────────────

function makeEntry(task, start, end) {
  return {
    id: nextId++,
    task:             task  || '',
    start:            start || '',
    end:              end   || '',
    status:           'idle',
    timerStartTs:     null,
    timerAccumulated: 0,
    dayOffset:        0,
  };
}

// ── Time helpers ────────────────────────────────────────────────

function parseMinutes(val) {
  if (!val) return null;
  const [hStr, mStr] = val.split(':');
  const h = parseInt(hStr, 10), m = parseInt(mStr, 10);
  return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
}

function minsToStr(total) {
  const clamped = ((Math.round(total) % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60), m = clamped % 60;
  return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
}

function nowStr() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function fmtMins(mins) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h === 0 ? `${m}m` : `${h}h ${m.toString().padStart(2,'0')}m`;
}

function fmtLive(mins) {
  const s = Math.floor(mins * 60);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2,'0')}m ${sec.toString().padStart(2,'0')}s`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2,'0')}s`;
  return `${sec}s`;
}

// Auto-detect next-day offset from start/end strings
function autoEndDayOffset(entry) {
  const sm = parseMinutes(entry.start);
  const em = parseMinutes(entry.end);
  if (sm === null || em === null) return 0;
  return em < sm ? 1 : 0;
}

// Accepts: "2h 30m", "2h30m", "2h", "30m", "1.5h", "90", "1:30"
function parseDurationInput(val) {
  if (!val) return null;
  const v = val.trim().toLowerCase();

  let m;
  // "2h 30m" / "2h30m" / "2h 30"
  m = v.match(/^(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\s*(\d+(?:\.\d+)?)\s*m?(?:in(?:utes?)?)?$/);
  if (m) return Math.round(parseFloat(m[1]) * 60 + parseFloat(m[2]));

  // "2h" / "2hrs" / "1.5 hours"
  m = v.match(/^(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?$/);
  if (m) return Math.round(parseFloat(m[1]) * 60);

  // "30m" / "30min" / "30 minutes"
  m = v.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?$/);
  if (m) return Math.round(parseFloat(m[1]));

  // "1:30" (h:mm)
  m = v.match(/^(\d+):(\d{1,2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);

  // plain number = minutes
  m = v.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Math.round(parseFloat(m[1]));

  return null;
}

// ── Span calculation ────────────────────────────────────────────────

function liveMinutes(entry) {
  const acc = entry.timerAccumulated || 0;
  if (entry.status !== 'running' || !entry.timerStartTs) return acc;
  return acc + (Date.now() - entry.timerStartTs) / 60000;
}

function calcSpan(entry) {
  if (entry.status === 'running') {
    const m = liveMinutes(entry);
    return m > 0 ? m : null;
  }
  if (entry.status === 'paused') {
    const m = entry.timerAccumulated || 0;
    return m > 0 ? m : null;
  }
  const s = parseMinutes(entry.start), e = parseMinutes(entry.end);
  if (s === null || e === null) return null;
  const diff = e - s + (entry.dayOffset || 0) * 1440;
  return diff > 0 ? diff : null;
}

function calcTotal() {
  return entries.reduce((sum, e) => sum + (calcSpan(e) ?? 0), 0);
}

// Returns how many days past midnight the end time falls (0 = same day, 1 = next day, etc.)
function endDayOffset(entry) {
  if (entry.status === 'idle') return entry.dayOffset || 0;
  const sm = parseMinutes(entry.start);
  if (sm === null) return 0;
  return Math.floor((sm + liveMinutes(entry)) / 1440);
}

// ── Timer actions ────────────────────────────────────────────────

function startTimer(entry) {
  if (entry.status === 'idle') {
    if (!entry.start) entry.start = nowStr();
    entry.timerAccumulated = 0;
  }
  entry.status = 'running';
  entry.timerStartTs = Date.now();
  startTick();
  save();
}

function pauseTimer(entry) {
  entry.timerAccumulated = liveMinutes(entry);
  entry.timerStartTs = null;
  entry.status = 'paused';
  save();
  if (!entries.some(e => e.status === 'running')) stopTick();
}

function completeTimer(entry) {
  const mins = liveMinutes(entry);
  const startMins = parseMinutes(entry.start);
  if (startMins !== null) {
    entry.end = minsToStr(startMins + mins);
    entry.dayOffset = Math.floor((startMins + mins) / 1440);
  } else {
    entry.end = nowStr();
    entry.dayOffset = 0;
  }
  entry.status = 'idle';
  entry.timerStartTs = null;
  entry.timerAccumulated = 0;
  save();
  if (!entries.some(e => e.status === 'running')) stopTick();
}

// ── Duration edit ────────────────────────────────────────────────

function applyDuration(entry, mins) {
  if (entry.status === 'paused') {
    entry.timerAccumulated = mins;
  } else if (entry.status === 'idle' && entry.start) {
    const sm = parseMinutes(entry.start);
    if (sm !== null) {
      entry.end = minsToStr(sm + mins);
      entry.dayOffset = Math.floor((sm + mins) / 1440);
    }
  }
}

// ── Slack ────────────────────────────────────────────────

let _saveHintTimer = null;
function showSaved() {
  const hint = document.getElementById('saveHint');
  if (!hint) return;
  hint.classList.add('visible');
  clearTimeout(_saveHintTimer);
  _saveHintTimer = setTimeout(() => hint.classList.remove('visible'), 1500);
}

function updateSlackBtn() {
  const btn = document.getElementById('slackBtn');
  if (btn) btn.style.display = webhookUrl ? '' : 'none';
}

function fmtTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const period = h >= 12 ? 'PM' : 'AM';
  return (h % 12 || 12) + ':' + m.toString().padStart(2, '0') + ' ' + period;
}

function updateSchedPeek() {
  const peek = document.getElementById('schedPeek');
  if (!peek) return;
  const settingsOpen = document.getElementById('settingsPanel').classList.contains('open');
  if (settingsOpen || !schedule.enabled || !webhookUrl) { peek.style.display = 'none'; return; }
  const DAY = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  let label;
  if (schedule.type === 'once') {
    const dateStr = schedule.date
      ? new Date(schedule.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    label = 'Once' + (dateStr ? ' · ' + dateStr : '') + ' at ' + fmtTime12(schedule.time);
  } else {
    const sorted = [...schedule.days].sort((a, b) => a - b);
    let days;
    if (sorted.length === 7) days = 'Daily';
    else if (JSON.stringify(sorted) === '[1,2,3,4,5]') days = 'Mon–Fri';
    else if (JSON.stringify(sorted) === '[0,6]') days = 'Weekends';
    else days = sorted.map(d => DAY[d]).join(', ');
    label = days + ' at ' + fmtTime12(schedule.time);
  }
  document.getElementById('schedPeekText').textContent = label;
  peek.style.display = '';
}

function formatSlackMessage() {
  const sendable = entries.filter(e => calcSpan(e) !== null);
  if (!sendable.length) return null;

  const d        = new Date();
  const day      = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const total    = calcTotal();
  const count    = sendable.length;
  const taskWord = count === 1 ? 'task' : 'tasks';

  // Workflow Builder webhook → plain text variable payload
  if (webhookUrl.includes('/triggers/')) {
    const lines = sendable.map(e => {
      const name = e.task.trim() || '(unnamed)';
      const dur  = fmtMins(calcSpan(e));
      let times;
      if (e.status === 'running')     times = `${e.start} → (running)`;
      else if (e.status === 'paused') times = `${e.start} → (paused)`;
      else { const end = e.end + (e.dayOffset > 0 ? ` +${e.dayOffset}` : ''); times = `${e.start} → ${end}`; }
      return `• ${name}  ${times}  ${dur}`;
    });
    return { message: `⏱ Time Summary — ${day}\n${lines.join('\n')}\nTotal: ${fmtMins(total)} across ${count} ${taskWord}` };
  }

  // Incoming Webhook → Block Kit JSON
  const lines = sendable.map(e => {
    const name = e.task.trim() || '(unnamed)';
    const dur  = fmtMins(calcSpan(e));
    let times;
    if (e.status === 'running') {
      times = `${e.start} → _(running)_`;
    } else if (e.status === 'paused') {
      times = `${e.start} → _(paused)_`;
    } else {
      const endLabel = e.end + (e.dayOffset > 0 ? ` +${e.dayOffset}` : '');
      times = `${e.start} → ${endLabel}`;
    }
    return `• *${name}*  ${times}  \`${dur}\``;
  });

  return {
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*⏱ Time Summary — ${day}*` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Total: *${fmtMins(total)}* across ${count} ${taskWord}` }],
      },
    ],
  };
}

async function sendToSlack() {
  if (!webhookUrl) return;
  const payload = formatSlackMessage();
  const btn = document.getElementById('slackBtn');

  if (!payload) {
    btn.textContent = 'Nothing to send';
    btn.classList.add('error');
    setTimeout(() => {
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M1 1L10 5.5L1 10V6.8L7 5.5L1 4.2V1Z" fill="currentColor"/></svg> Send to Slack`;
      btn.classList.remove('error');
    }, 2000);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    console.log('[TSC] webhook type:', webhookUrl.includes('/triggers/') ? 'Workflow Builder' : 'Incoming Webhook');
    console.log('[TSC] payload:', JSON.stringify(payload));
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    console.log('[TSC] response:', res.status, body);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body}`);
    btn.textContent = 'Sent ✓';
    btn.classList.add('sent');
    setTimeout(() => resetSlackBtn(btn), 2200);
  } catch (err) {
    console.error('[TSC] send error:', err);
    btn.textContent = 'Failed — check webhook URL';
    btn.classList.add('error');
    setTimeout(() => resetSlackBtn(btn), 3000);
  }
}

function resetSlackBtn(btn) {
  btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M1 1L10 5.5L1 10V6.8L7 5.5L1 4.2V1Z" fill="currentColor"/></svg> Send to Slack`;
  btn.classList.remove('sent', 'error');
  btn.disabled = false;
}

// ── Tick loop ────────────────────────────────────────────────

function startTick() {
  if (tickId) return;
  tickId = setInterval(() => {
    const running = entries.filter(e => e.status === 'running');
    if (running.length === 0) { stopTick(); return; }
    running.forEach(e => {
      const card = document.querySelector(`.entry-card[data-id="${e.id}"]`);
      if (card) tickCard(card, e);
    });
    updateTotal();
  }, 1000);
}

function stopTick() {
  if (tickId) { clearInterval(tickId); tickId = null; }
}

function tickCard(card, entry) {
  const durEl  = card.querySelector('.dur-input');
  const endInp = card.querySelector('.end-inp');
  const badge  = card.querySelector('.next-day');
  const mins   = liveMinutes(entry);
  if (durEl  && document.activeElement !== durEl)  durEl.value  = fmtLive(mins);
  if (endInp && document.activeElement !== endInp) {
    const sm = parseMinutes(entry.start);
    endInp.value = (sm !== null) ? minsToStr(sm + mins) : nowStr();
  }
  if (badge) {
    const offset = endDayOffset(entry);
    badge.textContent = `+${Math.max(1, offset)}`;
    badge.className = offset > 0 ? 'next-day nd-live' : 'next-day nd-hidden';
  }
}

// ── SVG icons ────────────────────────────────────────────────

const ICONS = {
  play:  `<svg width="10" height="11" viewBox="0 0 10 11" fill="none" aria-hidden="true"><path d="M2 1.5L8.5 5.5L2 9.5V1.5Z" fill="currentColor"/></svg>`,
  pause: `<svg width="10" height="11" viewBox="0 0 10 11" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="2.5" height="8" rx="1" fill="currentColor"/><rect x="6" y="1.5" width="2.5" height="8" rx="1" fill="currentColor"/></svg>`,
  check: `<svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden="true"><path d="M1 4L4 7.5L10 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  trash: `<svg width="10" height="11" viewBox="0 0 10 11" fill="none" aria-hidden="true"><path d="M1 3H9M4 1H6M2.5 3.5L3 9.5H7L7.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

// ── DOM ────────────────────────────────────────────────

function createEntryCard(entry) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.id = String(entry.id);
  card.dataset.status = entry.status;
  card.setAttribute('role', 'listitem');

  // ── Top row ──
  const top = document.createElement('div');
  top.className = 'entry-top';

  const dot = document.createElement('span');
  dot.className = `status-dot ${entry.status}`;

  const taskInp = document.createElement('input');
  taskInp.type = 'text';
  taskInp.className = 'task-input';
  taskInp.placeholder = 'Task name';
  taskInp.value = entry.task;
  taskInp.setAttribute('aria-label', 'Task name');
  taskInp.addEventListener('input', () => { entry.task = taskInp.value; save(); });
  taskInp.addEventListener('blur', () => { if (entry.task.trim()) showSaved(); });

  const controls = document.createElement('div');
  controls.className = 'entry-controls';

  const playBtn     = document.createElement('button');
  const completeBtn = document.createElement('button');
  const delBtn      = document.createElement('button');
  playBtn.type = completeBtn.type = delBtn.type = 'button';
  playBtn.className     = 'ctrl-btn btn-play';
  completeBtn.className = 'ctrl-btn btn-complete';
  delBtn.className      = 'ctrl-btn btn-delete';
  completeBtn.setAttribute('aria-label', 'Complete timer');
  delBtn.setAttribute('aria-label', 'Remove entry');
  completeBtn.innerHTML = ICONS.check;
  delBtn.innerHTML      = ICONS.trash;

  playBtn.addEventListener('click', () => {
    if (entry.status === 'running') pauseTimer(entry);
    else startTimer(entry);
    refreshCard(card, entry);
    updateTotal();
  });
  completeBtn.addEventListener('click', () => {
    completeTimer(entry);
    refreshCard(card, entry);
    updateTotal();
    showSaved();
  });
  delBtn.addEventListener('click', () => {
    entries = entries.filter(e => e.id !== entry.id);
    card.remove();
    if (!entries.some(e => e.status === 'running')) stopTick();
    updateTotal();
    updateCount();
    renderEmptyState();
    save();
  });

  controls.append(playBtn, completeBtn, delBtn);
  top.append(dot, taskInp, controls);

  // ── Bottom row ──
  const bottom = document.createElement('div');
  bottom.className = 'entry-bottom';

  const startInp = document.createElement('input');
  startInp.type = 'time';
  startInp.className = 'time-input start-inp';
  startInp.value = entry.start;
  startInp.setAttribute('aria-label', 'Start time');
  startInp.addEventListener('change', () => {
    const newVal = startInp.value;
    if (entry.status === 'running') {
      const sm = parseMinutes(newVal);
      if (sm !== null) {
        let elapsed = nowMinutes() - sm;
        if (elapsed < 0) elapsed += 1440;
        entry.timerAccumulated = elapsed;
        entry.timerStartTs = Date.now();
      }
    }
    entry.start = newVal;
    if (entry.status === 'idle') entry.dayOffset = autoEndDayOffset(entry);
    refreshCard(card, entry);
    updateTotal();
    save();
    showSaved();
  });

  const sep = document.createElement('span');
  sep.className = 'row-sep';
  sep.textContent = '→';
  sep.setAttribute('aria-hidden', 'true');

  const endInp = document.createElement('input');
  endInp.type = 'time';
  endInp.className = 'time-input end-inp';
  endInp.value = entry.end;
  endInp.setAttribute('aria-label', 'End time');
  endInp.addEventListener('change', () => {
    const newVal = endInp.value;
    entry.end = newVal;
    if (entry.status === 'running' || entry.status === 'paused') {
      entry.status = 'idle';
      entry.timerStartTs = null;
      entry.timerAccumulated = 0;
      if (!entries.some(e => e.status === 'running')) stopTick();
    }
    entry.dayOffset = autoEndDayOffset(entry);
    refreshCard(card, entry);
    updateTotal();
    save();
    showSaved();
  });

  // Duration — editable input
  const durEl = document.createElement('input');
  durEl.type = 'text';
  durEl.className = 'dur-input';
  durEl.setAttribute('aria-label', 'Duration');

  durEl.addEventListener('focus', () => { if (!durEl.readOnly) durEl.select(); });

  durEl.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); durEl.blur(); }
    if (e.key === 'Escape') { refreshCard(card, entry); durEl.blur(); }
  });

  durEl.addEventListener('blur', () => {
    if (durEl.readOnly) return;
    const mins = parseDurationInput(durEl.value);
    if (mins === null || mins <= 0) { refreshCard(card, entry); return; }
    applyDuration(entry, mins);
    refreshCard(card, entry);
    updateTotal();
    save();
    showSaved();
  });

  const nextDayBadge = document.createElement('span');
  nextDayBadge.className = 'next-day nd-empty';
  nextDayBadge.textContent = '+1';
  nextDayBadge.setAttribute('aria-label', 'toggle next-day');
  nextDayBadge.setAttribute('role', 'button');
  nextDayBadge.setAttribute('tabindex', '0');
  nextDayBadge.addEventListener('click', () => {
    if (entry.status !== 'idle') return;
    entry.dayOffset = (entry.dayOffset || 0) > 0 ? 0 : 1;
    refreshCard(card, entry);
    updateTotal();
    save();
    showSaved();
  });
  nextDayBadge.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && entry.status === 'idle') {
      e.preventDefault();
      entry.dayOffset = (entry.dayOffset || 0) > 0 ? 0 : 1;
      refreshCard(card, entry);
      updateTotal();
      save();
      showSaved();
    }
  });

  bottom.append(startInp, sep, endInp, nextDayBadge, durEl);
  card.append(top, bottom);

  refreshCard(card, entry);
  return card;
}

function refreshCard(card, entry) {
  card.dataset.status = entry.status;
  card.querySelector('.status-dot').className = `status-dot ${entry.status}`;

  const playBtn = card.querySelector('.btn-play');
  if (entry.status === 'running') {
    playBtn.innerHTML = ICONS.pause;
    playBtn.setAttribute('aria-label', 'Pause timer');
  } else {
    playBtn.innerHTML = ICONS.play;
    playBtn.setAttribute('aria-label', entry.status === 'paused' ? 'Resume timer' : 'Start timer');
  }

  const completeBtn = card.querySelector('.btn-complete');
  completeBtn.style.display = (entry.status === 'running' || entry.status === 'paused') ? '' : 'none';

  const startInp = card.querySelector('.start-inp');
  startInp.value = entry.start;

  const endInp = card.querySelector('.end-inp');
  const durEl  = card.querySelector('.dur-input');

  // Duration is editable when paused, or idle with a start time
  const durEditable = entry.status === 'paused' || (entry.status === 'idle' && !!entry.start);

  if (entry.status === 'running') {
    const mins = liveMinutes(entry);
    const sm   = parseMinutes(entry.start);
    if (document.activeElement !== endInp) {
      endInp.value = (sm !== null) ? minsToStr(sm + mins) : nowStr();
    }
    endInp.className = 'time-input end-inp end-live';
    if (document.activeElement !== durEl) durEl.value = fmtLive(mins);
    durEl.readOnly  = true;
    durEl.className = 'dur-input live';
  } else if (entry.status === 'paused') {
    const sm = parseMinutes(entry.start);
    const m  = entry.timerAccumulated || 0;
    endInp.value     = (sm !== null) ? minsToStr(sm + m) : (entry.end || '');
    endInp.className = 'time-input end-inp end-paused';
    if (document.activeElement !== durEl) durEl.value = m > 0 ? fmtMins(m) : '';
    durEl.readOnly  = false;
    durEl.className = 'dur-input live editable';
    durEl.placeholder = '0m';
  } else {
    endInp.value     = entry.end;
    endInp.className = 'time-input end-inp';
    const span = calcSpan(entry);
    if (document.activeElement !== durEl) durEl.value = span !== null ? fmtMins(span) : (durEditable ? '' : '—');
    durEl.readOnly  = !durEditable;
    durEl.className = span !== null
      ? `dur-input live${durEditable ? ' editable' : ''}`
      : (durEditable ? 'dur-input editable' : 'dur-input');
    durEl.placeholder = durEditable ? '0m' : '';
  }

  const badge = card.querySelector('.next-day');
  const offset = endDayOffset(entry);
  badge.textContent = `+${Math.max(1, offset)}`;
  if (entry.status === 'idle') {
    badge.className = offset > 0 ? 'next-day nd-active' : 'next-day nd-empty';
  } else {
    badge.className = offset > 0 ? 'next-day nd-live' : 'next-day nd-hidden';
  }
}

// ── Global UI ────────────────────────────────────────────────

function updateTotal() {
  const el = document.getElementById('totalValue');
  if (el.classList.contains('copied')) return;
  const t = calcTotal();
  el.textContent = t > 0 ? fmtMins(t) : '—';
}

function updateCount() {
  const el = document.getElementById('entryCount');
  el.textContent = entries.length === 0 ? ''
    : entries.length === 1 ? '1 entry' : `${entries.length} entries`;
}

function renderEmptyState() {
  const container = document.getElementById('entries');
  const existing  = document.getElementById('emptyState');
  if (entries.length === 0 && !existing) {
    const div = document.createElement('div');
    div.id = 'emptyState';
    div.className = 'empty-state';
    div.textContent = 'No entries. Add one or hit play to start a timer.';
    container.appendChild(div);
  } else if (entries.length > 0 && existing) {
    existing.remove();
  }
}

function render() {
  const container = document.getElementById('entries');
  container.innerHTML = '';
  entries.forEach(e => container.appendChild(createEntryCard(e)));
  if (entries.some(e => e.status === 'running')) startTick();
  updateTotal();
  updateCount();
  renderEmptyState();
}

// ── Init ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadEntries(render);

  // Slack settings
  loadWebhook(() => {
    document.getElementById('webhookInp').value = webhookUrl;
    updateSlackBtn();
    const section = document.getElementById('schedSection');
    if (section) section.style.display = webhookUrl ? '' : 'none';
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    const panel = document.getElementById('settingsPanel');
    const btn   = document.getElementById('settingsBtn');
    const open  = panel.classList.toggle('open');
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-hidden', String(!open));
    updateSchedPeek();
    if (open) document.getElementById('webhookInp').focus();
  });

  document.getElementById('guideToggle').addEventListener('click', () => {
    const steps  = document.getElementById('guideSteps');
    const toggle = document.getElementById('guideToggle');
    const open   = steps.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  document.querySelectorAll('.guide-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.guide-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const paneId = tab.dataset.pane;
      document.querySelectorAll('.guide-list').forEach(p => {
        p.style.display = p.id === paneId ? '' : 'none';
      });
    });
  });

  const webhookInp = document.getElementById('webhookInp');
  webhookInp.addEventListener('blur', () => {
    saveWebhook(webhookInp.value.trim());
    updateSlackBtn();
    updateSchedVisibility();
    updateSchedPeek();
    if (webhookInp.value.trim()) showSaved();
  });
  webhookInp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); webhookInp.blur(); }
    if (e.key === 'Escape') {
      webhookInp.value = webhookUrl;
      webhookInp.blur();
    }
  });

  document.getElementById('slackBtn').addEventListener('click', sendToSlack);

  const schedPeekEl = document.getElementById('schedPeek');
  function openSettingsFromPeek() {
    const panel = document.getElementById('settingsPanel');
    const btn   = document.getElementById('settingsBtn');
    if (!panel.classList.contains('open')) {
      panel.classList.add('open');
      btn.classList.add('active');
      btn.setAttribute('aria-expanded', 'true');
      panel.setAttribute('aria-hidden', 'false');
      updateSchedPeek();
      document.getElementById('webhookInp').focus();
    }
  }
  schedPeekEl.addEventListener('click', openSettingsFromPeek);
  schedPeekEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSettingsFromPeek(); } });

  document.getElementById('addBtn').addEventListener('click', () => {
    const last = entries[entries.length - 1];
    const prefill = (last && last.status === 'idle' && last.end) ? last.end : '';
    const entry = makeEntry('', prefill, '');
    entries.push(entry);
    const ex = document.getElementById('emptyState');
    if (ex) ex.remove();
    const card = createEntryCard(entry);
    document.getElementById('entries').appendChild(card);
    card.querySelector('.task-input').focus();
    updateTotal();
    updateCount();
    save();
    card.scrollIntoView({ block: 'nearest' });
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!entries.length) return;
    stopTick();
    entries = [];
    render();
    save();
  });

  // ── Schedule UI ──────────────────────────────────────────────
  function updateSchedVisibility() {
    const section = document.getElementById('schedSection');
    if (section) section.style.display = webhookUrl ? '' : 'none';
  }

  function renderScheduleUI() {
    document.getElementById('schedEnabled').checked = schedule.enabled;
    document.getElementById('schedTime').value  = schedule.time || '17:00';
    document.getElementById('schedDate').value  = schedule.date || '';

    const body = document.getElementById('schedBody');
    body.classList.toggle('open', schedule.enabled);

    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === schedule.type);
    });

    document.getElementById('schedDaysRow').style.display = schedule.type === 'recurring' ? '' : 'none';
    document.getElementById('schedDateRow').style.display = schedule.type === 'once'      ? '' : 'none';

    document.querySelectorAll('.day-btn').forEach(btn => {
      btn.classList.toggle('active', schedule.days.includes(Number(btn.dataset.day)));
    });
  }

  loadSchedule(() => {
    updateSchedVisibility();
    renderScheduleUI();
    updateSchedPeek();
  });

  document.getElementById('schedEnabled').addEventListener('change', e => {
    schedule.enabled = e.target.checked;
    document.getElementById('schedBody').classList.toggle('open', schedule.enabled);
    saveSchedule();
    applyAlarms();
    updateSchedPeek();
    showSaved();
  });

  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      schedule.type = btn.dataset.type;
      renderScheduleUI();
      saveSchedule();
      applyAlarms();
      updateSchedPeek();
      showSaved();
    });
  });

  document.getElementById('schedTime').addEventListener('change', e => {
    schedule.time = e.target.value;
    saveSchedule();
    applyAlarms();
    updateSchedPeek();
    showSaved();
  });

  document.getElementById('schedDate').addEventListener('change', e => {
    schedule.date = e.target.value;
    saveSchedule();
    applyAlarms();
    updateSchedPeek();
    showSaved();
  });

  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = Number(btn.dataset.day);
      const idx = schedule.days.indexOf(day);
      if (idx >= 0) schedule.days.splice(idx, 1);
      else schedule.days.push(day);
      btn.classList.toggle('active', schedule.days.includes(day));
      saveSchedule();
      applyAlarms();
      updateSchedPeek();
      showSaved();
    });
  });

  const tv = document.getElementById('totalValue');
  function copyTotal() {
    const text = tv.textContent;
    if (text === '—' || tv.classList.contains('copied')) return;
    navigator.clipboard.writeText(text).then(() => {
      tv.classList.add('copied');
      tv.textContent = 'Copied!';
      setTimeout(() => { tv.classList.remove('copied'); updateTotal(); }, 1400);
    }).catch(() => {});
  }
  tv.addEventListener('click', copyTotal);
  tv.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyTotal(); }
  });
});
