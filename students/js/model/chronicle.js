// Weeks (batch 2): the numbers behind the weekly report.
//
//   lastWeek        Monday to Sunday before this week
//   chronicle       what that week held: focus (and against the week
//                   before), best day, top subjects, tasks, logged time,
//                   days shown up, how the days felt, what you learned
//   newMoments      discoveries you haven't been shown yet
//
// Everything is worked out from what's already stored; nothing new is kept
// except, in your preferences, which week and which moments you've seen.
//
// Pure (tests/students-model.test.mjs).
import { DAY, startOfWeek, addDays, dayKey, parseDayKey } from "./time.js";
import { activeDays } from "./world-model.js";

const sum = (rows, f) => rows.reduce((n, r) => n + (f(r) || 0), 0);
const inRange = (iso, a, b) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= a && t < b;
};

/** [start, end) of the week before the one containing `now`, and its key. */
export function lastWeek(now = Date.now()) {
  const end = startOfWeek(now).getTime();
  const start = addDays(new Date(end), -7).getTime();
  return { start, end, key: dayKey(start) };
}

/** Which week of your world a moment falls in, counted from 1. */
export function weekNumber(bornAt, at) {
  const born = Date.parse(bornAt || "");
  if (!Number.isFinite(born)) return 1;
  return Math.max(1, Math.floor((startOfWeek(at).getTime() - startOfWeek(born).getTime()) / (7 * DAY)) + 1);
}

export function chronicle({ sessions = [], tasks = [], logs = [], entries = [], discoveries = [] }, { start, end }) {
  const week = sessions.filter((s) => inRange(s.started_at, start, end));
  const prev = sessions.filter((s) => inRange(s.started_at, start - 7 * DAY, start));
  const focusMinutes = sum(week, (s) => s.focused_minutes);
  const prevFocusMinutes = sum(prev, (s) => s.focused_minutes);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(new Date(start), i);
    const a = d.getTime();
    const b = addDays(d, 1).getTime();
    days.push({ key: dayKey(d), label: d.toLocaleDateString(undefined, { weekday: "short" }), minutes: sum(week.filter((s) => inRange(s.started_at, a, b)), (s) => s.focused_minutes) });
  }
  const best = days.reduce((m, d) => (d.minutes > (m?.minutes || 0) ? d : m), null);

  const bySubject = new Map();
  for (const s of week) {
    const k = (s.subject || "").trim() || "Unlabelled";
    bySubject.set(k, (bySubject.get(k) || 0) + (s.focused_minutes || 0));
  }
  const subjects = [...bySubject].map(([subject, minutes]) => ({ subject, minutes })).filter((x) => x.minutes > 0).sort((a, b) => b.minutes - a.minutes).slice(0, 3);

  const tasksDone = tasks.filter((t) => t.done_at && inRange(t.done_at, start, end)).length;
  const startKey = dayKey(start);
  const endKey = dayKey(end);
  const weekLogs = logs.filter((l) => l.occurred_on >= startKey && l.occurred_on < endKey);
  const logged = {};
  for (const l of weekLogs) logged[l.kind] = (logged[l.kind] || 0) + (l.minutes || 0);

  const weekEntries = entries.filter((e) => e.day >= startKey && e.day < endKey);
  const moods = weekEntries.map((e) => e.mood).filter(Boolean);
  const mood = moods.length ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 : null;
  const intentions = weekEntries.filter((e) => e.intention);
  const kept = intentions.filter((e) => e.intention_done === "yes").length;
  const words = weekEntries
    .flatMap((e) => [e.learned && { kind: "learned", text: e.learned, day: e.day }, e.win && { kind: "win", text: e.win, day: e.day }])
    .filter(Boolean)
    .slice(0, 4);

  const all = activeDays({ sessions, tasks, logs, entries });
  const shown = days.filter((d) => all.has(d.key)).map((d) => d.key);

  const found = discoveries.filter((d) => inRange(d.at, start, end));
  const empty = !focusMinutes && !tasksDone && !weekLogs.length && !shown.length;
  const deep = week.filter((s) => s.quality === 3).length;
  return { start, end, focusMinutes, prevFocusMinutes, deep, sessions: week.length, days, best: best?.minutes ? best : null, subjects, tasksDone, logged, shown, mood, intentions: intentions.length, kept, words, discoveries: found, empty };
}

/**
 * Discoveries to celebrate: not seen yet, and recent enough to still feel
 * like news (older ones are quietly marked seen, so an old account isn't
 * flooded the first time this runs).
 */
export function newMoments(discoveries = [], seen = [], now = Date.now(), within = 7 * DAY) {
  const known = new Set(seen);
  const fresh = [];
  const stale = [];
  for (const d of discoveries) {
    if (known.has(d.id)) continue;
    if (Date.parse(d.at) >= now - within) fresh.push(d);
    else stale.push(d);
  }
  fresh.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { fresh, stale };
}

export { parseDayKey };
