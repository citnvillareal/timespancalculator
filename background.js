'use strict';

const STORAGE_KEY  = 'tsc_v3_entries';
const WEBHOOK_KEY  = 'tsc_webhook';
const SCHEDULE_KEY = 'tsc_schedule';

// Duplicated helpers — no shared module yet
function parseMinutes(v) {
  if (!v) return null;
  const [h, m] = v.split(':').map(Number);
  return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
}
function fmtMins(m) {
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h === 0 ? `${r}m` : `${h}h ${r.toString().padStart(2, '0')}m`;
}
function liveMinutes(e) {
  const acc = e.timerAccumulated || 0;
  return (e.status !== 'running' || !e.timerStartTs) ? acc : acc + (Date.now() - e.timerStartTs) / 60000;
}
function calcSpan(e) {
  if (e.status === 'running') { const m = liveMinutes(e); return m > 0 ? m : null; }
  if (e.status === 'paused')  { const m = e.timerAccumulated || 0; return m > 0 ? m : null; }
  const s = parseMinutes(e.start), en = parseMinutes(e.end);
  if (s === null || en === null) return null;
  const d = en - s + (e.dayOffset || 0) * 1440;
  return d > 0 ? d : null;
}

function buildPayload(entries) {
  const sendable = entries.filter(e => calcSpan(e) !== null);
  if (!sendable.length) return null;

  const d   = new Date();
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const lines = sendable.map(e => {
    const name = e.task.trim() || '(unnamed)';
    const dur  = fmtMins(calcSpan(e));
    let times;
    if (e.status === 'running') times = `${e.start} → _(running)_`;
    else if (e.status === 'paused') times = `${e.start} → _(paused)_`;
    else { const end = e.end + (e.dayOffset > 0 ? ` +${e.dayOffset}` : ''); times = `${e.start} → ${end}`; }
    return `• *${name}*  ${times}  \`${dur}\``;
  });

  const total = entries.reduce((s, e) => s + (calcSpan(e) ?? 0), 0);
  const count = sendable.length;
  return {
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*⏱ Time Summary — ${day}*` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Total: *${fmtMins(total)}* across ${count} ${count === 1 ? 'task' : 'tasks'}` }] },
    ],
  };
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'tsc_recurring' && alarm.name !== 'tsc_once') return;

  const result = await chrome.storage.local.get([STORAGE_KEY, WEBHOOK_KEY, SCHEDULE_KEY]);
  const schedule   = result[SCHEDULE_KEY];
  const webhookUrl = result[WEBHOOK_KEY];
  const entries    = result[STORAGE_KEY];

  if (!schedule?.enabled || !webhookUrl || !Array.isArray(entries)) return;

  // Day filter for recurring alarms
  if (alarm.name === 'tsc_recurring') {
    const today = new Date().getDay();
    if (Array.isArray(schedule.days) && !schedule.days.includes(today)) return;
  }

  const payload = buildPayload(entries);
  if (!payload) return; // no entries — skip silently

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (_) {}

  // Disable one-shot schedule after it fires
  if (alarm.name === 'tsc_once') {
    await chrome.storage.local.set({ [SCHEDULE_KEY]: { ...schedule, enabled: false } });
  }
});
