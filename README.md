# Time Span Calculator

A Chrome extension for tracking how long you spend across multiple tasks in a day. Add time entries manually, or use the built-in timer to track in real time. Send a formatted summary to any Slack channel when you're done.

## Features

- **Manual entries** — type a start and end time; duration is computed automatically
- **Task timer** — start, pause, and complete a timer per entry; the clock ticks live in the popup
- **Editable times while running** — change the start time on a live timer to backdate it; set the end time to stop and stamp it
- **Editable duration** — when an entry is idle (with a start time) or paused, type a duration directly (`2h 30m`, `1.5h`, `90`, `1:30`) and the end time updates to match
- **Next-day indicator** — a `+1` badge appears between the end time and duration whenever an entry crosses midnight. Click it to toggle manually; it resets to auto-detection when you edit either time field
- **Slack integration** — send a formatted task summary to any Slack channel via an Incoming Webhook; a built-in setup guide walks through creating one
- **Scheduled sends** — automatically post the daily summary to Slack at a configurable time; supports recurring weekday/custom-day schedules or a single one-time send on a specific date; silently skipped if there are no entries
- **Dark and light mode** — automatically matches the OS color scheme; no setting required
- **Persistent state** — all entries survive closing and reopening the popup (`chrome.storage.local`)
- **Copy total** — click the total to copy it to the clipboard

## Installing as an unpacked extension

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select this folder
5. The clock icon appears in your toolbar — pin it for easy access

## Usage

### Adding entries

Click **Add entry** to append a new row. Each entry has:

| Field | Behaviour |
|---|---|
| Task name | Free-text label (optional) |
| Start time | `HH:MM` picker; auto-filled when you start a timer with no start time set |
| End time | `HH:MM` picker; updated live while the timer is running |
| `+1` badge | Indicates the entry ends the next day; click to toggle |
| Duration | Computed from start/end for idle entries; live `Xh XXm XXs` while running; editable when idle or paused |

### Timer controls

| Button | Action |
|---|---|
| ▶ | Start timer (or resume if paused) |
| ⏸ | Pause — banks elapsed time |
| ✓ | Complete — stamps the end time and stops the timer |

Multiple timers can run simultaneously.

### Duration input formats

When the duration field is editable, these formats are all accepted:

```
2h 30m   →  2 hours 30 minutes
2h       →  2 hours exactly
90m      →  90 minutes
1.5h     →  1 hour 30 minutes
1:30     →  1 hour 30 minutes
90       →  90 minutes (plain number = minutes)
```

### Next-day entries

If an end time is earlier than the start time (e.g. `23:00 → 01:30`), the `+1` badge appears automatically and the correct 2h 30m span is calculated. If the auto-detection is wrong, click the badge to toggle it off or on.

### Sending to Slack

Click the gear icon (⚙) in the header to open the settings panel. Paste a Slack Incoming Webhook URL into the field — a **"How to get a webhook URL"** guide is built in if you need it. Once saved, a **Send to Slack** button appears in the footer.

The message posted to Slack includes each task, its time range, duration, and the session total:

```
⏱ Time Summary — Mon 30 Jun
────────────────────────────
• Morning standup   09:00 → 09:30   30m
• Deep work block   09:30 → 12:00   2h 30m
• Code review       13:00 → 14:30   1h 30m

Total: 4h 30m across 3 tasks
```

Entries still running or paused are included and marked as _(running)_ or _(paused)_.

### Scheduled sends

In the settings panel, the **Auto-send to Slack** section appears once a webhook URL is saved. Enable the toggle to activate scheduling:

| Option | Description |
|---|---|
| **Recurring** | Fires every day at the set time; choose which days of the week to include |
| **One-time** | Fires once on a specific date and time, then disables itself |

The send runs in the background via a Chrome service worker — the popup does not need to be open. If there are no valid entries when the alarm fires, the send is silently skipped.

#### Creating a webhook URL

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and sign in
2. **Create New App** → **From scratch**
3. Name it anything (e.g. `Time Tracker`), select your workspace → **Create App**
4. In the sidebar under *Features*, click **Incoming Webhooks**
5. Toggle **Activate Incoming Webhooks** to On
6. Click **Add New Webhook to Workspace**, choose a channel → **Allow**
7. Copy the webhook URL and paste it into the extension settings

## File structure

```
time_span_caculator/
├── manifest.json     # Manifest V3 — permissions: storage, alarms; host_permissions: hooks.slack.com
├── popup.html        # Extension popup shell
├── popup.css         # Dark/light-mode UI styles
├── popup.js          # All state, timer logic, Slack integration, scheduling, and DOM
├── background.js     # Service worker — Chrome alarms listener, scheduled Slack sends
├── store/
│   ├── listing.md         # Chrome Web Store copy
│   └── privacy-policy.html  # Hosted privacy policy page
└── icons/
    ├── icon16.svg
    ├── icon48.svg
    └── icon128.svg
```

## Technical notes

- **Manifest V3** with `chrome.storage.local` for persistence (falls back to `localStorage` in the browser preview)
- Timer accuracy: start time is stored as an absolute Unix timestamp (`Date.now()`), so the elapsed time is correct even if the popup is closed and reopened mid-session
- Overnight spans: `minsToStr` wraps modulo 1440; the `dayOffset` field on each entry (0 = same day, 1 = next day) drives both the badge and the span calculation
- Slack: the webhook URL is stored in `chrome.storage.local` under `tsc_webhook`; the message uses [Slack Block Kit](https://api.slack.com/block-kit); the only outbound host permission is `https://hooks.slack.com/*`
- Scheduled sends: the schedule object (`tsc_schedule`) is stored in `chrome.storage.local`; `chrome.alarms.create` is called with a `when` timestamp for both recurring and one-shot alarms (recurring adds `periodInMinutes: 1440`); the background service worker reads entries and fires the webhook — the popup does not need to be open; one-time schedules set `enabled: false` after firing
- Dark/light mode: `color-scheme: dark` is declared on `:root` by default; a `@media (prefers-color-scheme: light)` block overrides all CSS variables and re-declares the `@keyframes pulse-dot` animation with the light-mode accent colour; hardcoded `rgba` values used in badges and hover states are also overridden in the same block
- No external dependencies — vanilla JS and CSS only
