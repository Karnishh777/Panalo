// Message snooze.
//
// "Come back to this at 6pm." The message goes out of your head, the chat
// stops asking to be replied to, and at the chosen time it re-appears — the
// chat bumps back to the top of the list as unread, with an in-app banner
// nudging you to reply.
//
// Everything lives in localStorage. That means snoozes are per-device (a
// snooze set on your phone doesn't fire on your laptop), which matches the
// tone of the feature — it's a personal reminder, not shared state.
import { showBanner, playChime } from "./notifications.js";
import { rollbackReadTo } from "./unread.js";

const KEY = "panalo.snoozes";
const timers = new Map();
let onFire = null;

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota — ignore */
  }
}

export function isSnoozed(msgId) {
  return read().some((s) => s.msgId === msgId);
}
export function pendingCount() {
  return read().length;
}
export function pendingFor(convId) {
  return read().filter((s) => s.convId === convId).sort((a, b) => a.wakeAt - b.wakeAt);
}

// Set the callback the app uses to react to a firing snooze (bump the list,
// refresh badges, etc.). Wired once by chat.js.
export function setSnoozeFireHandler(fn) {
  onFire = fn;
}

// Add a snooze and schedule it. Idempotent: re-snoozing the same message
// simply replaces the previous entry.
export function snoozeMessage({ msgId, convId, msgCreatedAt, wakeAt, sample, from }) {
  const list = read().filter((s) => s.msgId !== msgId);
  const entry = { msgId, convId, msgCreatedAt, wakeAt, sample, from };
  list.push(entry);
  write(list);
  schedule(entry);
}

export function cancelSnooze(msgId) {
  const list = read().filter((s) => s.msgId !== msgId);
  write(list);
  if (timers.has(msgId)) {
    clearTimeout(timers.get(msgId));
    timers.delete(msgId);
  }
}

// setTimeout can't safely take numbers over ~24.8 days; anything longer would
// silently fire immediately. Skip scheduling if that far away — startSnoozes
// re-checks on every app load anyway.
const MAX_DELAY = 2 ** 31 - 1;

function fire(entry) {
  timers.delete(entry.msgId);
  const list = read().filter((s) => s.msgId !== entry.msgId);
  write(list);
  // Roll the read pointer back so this message shows up as unread again.
  rollbackReadTo(entry.convId, entry.msgCreatedAt);
  // Then everything else — the chat list refresh, the banner, the sound.
  onFire?.(entry);
  const body = entry.sample ? `“${entry.sample.slice(0, 90)}”` : "Time to reply.";
  showBanner(`⏰ Reminder · ${entry.from || "chat"}`, body, entry.convId);
  playChime();
}

function schedule(entry) {
  const now = Date.now();
  const delay = entry.wakeAt - now;
  if (timers.has(entry.msgId)) {
    clearTimeout(timers.get(entry.msgId));
    timers.delete(entry.msgId);
  }
  if (delay <= 0) {
    // Fire immediately for anything already overdue — e.g. the tab was closed
    // when the wake time came round.
    fire(entry);
    return;
  }
  if (delay > MAX_DELAY) return; // will be re-checked on the next load
  timers.set(entry.msgId, setTimeout(() => fire(entry), delay));
}

// On app load, catch up: fire anything overdue and schedule the rest.
export function startSnoozes() {
  const list = read();
  for (const entry of list) schedule(entry);
}

// ---- Preset "wake at" times ----
// Times are computed locally, which is what a human means by "this evening."
function atToday(hour) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}
function atDaysAhead(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

// Returns [{ label, at }] — presets that are actually in the future. "This
// evening" disappears if it's already past 6pm.
export function presetOptions() {
  const now = Date.now();
  const options = [
    { label: "In 1 hour", at: now + 60 * 60 * 1000 },
    { label: "In 3 hours", at: now + 3 * 60 * 60 * 1000 },
    { label: "This evening (6pm)", at: atToday(18) },
    { label: "Tomorrow morning (9am)", at: atDaysAhead(1, 9) },
    { label: "Tomorrow evening (6pm)", at: atDaysAhead(1, 18) },
    { label: "Next week", at: atDaysAhead(7, 9) },
  ];
  return options.filter((o) => o.at > now + 60 * 1000); // trim anything already past
}

// Short, human "in 2 hours" / "tomorrow at 9am" for the confirmation toast.
export function humanWhen(ts) {
  const now = new Date();
  const then = new Date(ts);
  const mins = Math.round((ts - now.getTime()) / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  const sameDay = then.toDateString() === now.toDateString();
  const time = then.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
  if (sameDay) return `at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (then.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  if (hours < 24 * 7) return `${then.toLocaleDateString(undefined, { weekday: "short" })} at ${time}`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + `, ${time}`;
}
