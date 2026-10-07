// Weeks, seasons and the world over time (batch 2).
//
//   lastWeek        Monday to Sunday before this week
//   chronicle       what that week held: focus (and against the week
//                   before), best day, top subjects, tasks, logged time,
//                   days shown up, how the days felt, what you learned
//   worldAt         your world as it was at any moment, from your history
//   timeline        frames of the world from its birth to now (time-lapse)
//   season          28-day chapters from the day your world was born
//   newMoments      discoveries you haven't been shown yet
//
// Everything is worked out from what's already stored; nothing new is kept
// except, in your preferences, which week and which moments you've seen.
//
// Pure (tests/students-model.test.mjs).
import { DAY, startOfDay, startOfWeek, addDays, dayKey, parseDayKey } from "./time.js";
import { buildWorld, activeDays } from "./world-model.js";

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

/** Your history as it stood at `at`: the world you had then. */
export function worldAt({ sessions = [], tasks = [], logs = [], goals = [], entries = [], sentMessages = [], bornAt = null }, at) {
  const before = (iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t < at;
  };
  const dayBefore = dayKey(at);
  return buildWorld({
    sessions: sessions.filter((s) => before(s.started_at)),
    tasks: tasks.map((t) => (t.done_at && !before(t.done_at) ? { ...t, done_at: null } : t)),
    logs: logs.filter((l) => l.occurred_on < dayBefore),
    goals: goals.filter((g) => !g.created_at || before(g.created_at)).map((g) => (g.done_at && !before(g.done_at) ? { ...g, done_at: null } : g)),
    entries: entries.filter((e) => e.day < dayBefore),
    sentMessages: sentMessages.filter((m) => before(m.created_at)),
    bornAt,
    now: at,
  });
}

/** `frames` snapshots of the world, evenly from its birth to now. */
export function timeline(data, now = Date.now(), frames = 24) {
  const born = Date.parse(data.bornAt || "");
  const first = [...(data.sessions || []).map((s) => Date.parse(s.started_at)), ...(data.tasks || []).map((t) => Date.parse(t.created_at))].filter(Number.isFinite);
  const start = Number.isFinite(born) ? born : first.length ? Math.min(...first) : now - 7 * DAY;
  const span = Math.max(DAY, now - start);
  const out = [];
  for (let i = 0; i < frames; i++) {
    const at = i === frames - 1 ? now + 1 : start + (span * (i + 1)) / frames;
    const w = worldAt(data, at);
    out.push({ at: Math.min(at, now), layers: w.layers, moons: w.moons, focusMinutes: w.stats.focusMinutesTotal, tasksDone: w.stats.tasksDone });
  }
  return out;
}

export const SEASON_DAYS = 28;
const SEASON_NAMES = ["First Light", "Tides", "Ember", "Bloom", "Drift", "Aurora", "Monsoon", "Frost", "Comet", "Harvest", "Eclipse", "Zenith"];

/** Which 28-day chapter of your world `now` is in. */
export function season(bornAt, now = Date.now()) {
  const born = Date.parse(bornAt || "");
  const b = Number.isFinite(born) ? startOfDay(born).getTime() : startOfDay(now).getTime();
  const day = Math.max(0, Math.round((startOfDay(now).getTime() - b) / DAY));
  const index = Math.floor(day / SEASON_DAYS);
  const start = b + index * SEASON_DAYS * DAY;
  return {
    number: index + 1,
    name: SEASON_NAMES[index % SEASON_NAMES.length],
    day: (day % SEASON_DAYS) + 1,
    length: SEASON_DAYS,
    left: SEASON_DAYS - (day % SEASON_DAYS) - 1,
    start,
    end: start + SEASON_DAYS * DAY,
  };
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
