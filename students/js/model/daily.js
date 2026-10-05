// The day as a ritual (phase 24): morning, evening, and the rhythm between.
//
//   todayEntry      the row for today, if any
//   lastVisit       when you were last here before today (the previous
//                   entry's opened_at), so the dawn can say what changed
//   sinceLast       what you did between then and now, in plain numbers
//   sinceLines      the same, as short sentences for the dawn
//   rhythm          the last seven days as dots, counted forgivingly
//   monthSky        this month as a constellation: one star per day, lit
//                   where you showed up, joined in order
//
// There is no streak here on purpose. A missed day is just an unlit star;
// nothing is lost and nothing resets.
//
// Pure (tests/students-model.test.mjs).
import { DAY, startOfDay, dayKey, parseDayKey, formatMinutes } from "./time.js";

export const MOODS = [
  { v: 1, label: "Rough" },
  { v: 2, label: "Low" },
  { v: 3, label: "Okay" },
  { v: 4, label: "Good" },
  { v: 5, label: "Great" },
];
export const ENERGY = [
  { v: 1, label: "Empty" },
  { v: 2, label: "Tired" },
  { v: 3, label: "Steady" },
  { v: 4, label: "Charged" },
  { v: 5, label: "Electric" },
];
export const DONE = [
  { v: "yes", label: "Yes" },
  { v: "partly", label: "Partly" },
  { v: "no", label: "Not today" },
];

/** "morning" before 12, "afternoon" before 17, else "evening" (late night counts as evening). */
export function dayPart(now = Date.now()) {
  const h = new Date(now).getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  return "evening";
}

export function todayEntry(entries = [], now = Date.now()) {
  const key = dayKey(now);
  return entries.find((e) => e.day === key) || null;
}

/** When you were last here, before today: the latest earlier opened_at. */
export function lastVisit(entries = [], now = Date.now()) {
  const today = dayKey(now);
  let best = null;
  for (const e of entries) {
    if (e.day >= today || !e.opened_at) continue;
    const t = Date.parse(e.opened_at);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best;
}

const after = (iso, since) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= since;
};

/**
 * What happened between `since` and now. Logged activities count by the day
 * they were logged for, from the day of `since` on.
 */
export function sinceLast({ sessions = [], tasks = [], logs = [], discoveries = [] }, since, now = Date.now()) {
  const sinceDay = dayKey(since);
  const focusMinutes = sessions.filter((s) => after(s.started_at, since)).reduce((n, s) => n + (s.focused_minutes || 0), 0);
  const tasksDone = tasks.filter((t) => t.done_at && after(t.done_at, since)).length;
  const logged = {};
  for (const l of logs) if (l.occurred_on >= sinceDay) logged[l.kind] = (logged[l.kind] || 0) + (l.minutes || 0);
  const found = discoveries.filter((d) => after(d.at, since) && Date.parse(d.at) <= now);
  const daysAway = Math.max(0, Math.round((startOfDay(now).getTime() - startOfDay(since).getTime()) / DAY));
  return { focusMinutes, tasksDone, logged, discoveries: found, daysAway };
}

const KIND_LINE = {
  read: (m) => `${formatMinutes(m)} of reading lit the seas`,
  create: (m) => `${formatMinutes(m)} of making lit the aurora`,
  move: (m) => `${formatMinutes(m)} of moving greened the land`,
  rest: (m) => `${formatMinutes(m)} of rest greened the land`,
  connect: (m) => `${formatMinutes(m)} with people thickened the air`,
};

/** Up to four short lines for the dawn, most striking first. */
export function sinceLines(d) {
  const lines = [];
  for (const disc of d.discoveries.slice(0, 2)) lines.push(`Discovery: ${disc.title}`);
  if (d.focusMinutes) lines.push(`${formatMinutes(d.focusMinutes)} of focus raised new land`);
  if (d.tasksDone) lines.push(`${d.tasksDone} new light${d.tasksDone === 1 ? "" : "s"} on the night side`);
  for (const k of ["create", "read", "move", "rest", "connect"]) if (d.logged[k]) lines.push(KIND_LINE[k](d.logged[k]));
  if (!lines.length) {
    if (d.daysAway >= 2) lines.push(`${d.daysAway} days away. The clouds clear as soon as you do anything.`);
    else lines.push("A quiet day yesterday. Today is unwritten.");
  }
  return lines.slice(0, 4);
}

/** The last seven days, oldest first, and how many you showed up on. */
export function rhythm(days, now = Date.now()) {
  const today = startOfDay(now).getTime();
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today - i * DAY);
    const key = dayKey(d);
    week.push({ key, label: d.toLocaleDateString(undefined, { weekday: "narrow" }), name: d.toLocaleDateString(undefined, { weekday: "long" }), active: days.has(key), today: i === 0 });
  }
  const count = week.filter((w) => w.active).length;
  return { week, count };
}

/** A line about the week that never scolds. */
export function rhythmLine(count, todayActive) {
  if (count === 0) return "A fresh week of sky. Any one thing lights today's star.";
  if (count >= 5) return `${count} of the last 7 days. Your ring is out.`;
  if (todayActive) return `${count} of the last 7 days, today included.`;
  return `${count} of the last 7 days. Today's star is still unlit.`;
}

function seeded(seed) {
  let a = 0x9e3779b9;
  for (const c of String(seed)) a = Math.imul(a ^ c.charCodeAt(0), 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * This month as a constellation in a 100×60 box. Each day of the month has
 * a fixed place (seeded by person and month, so it's the same shape every
 * time you look, and a different one each month); stars you lit are joined
 * in the order you lit them.
 */
export function monthSky(days, now = Date.now(), seed = "") {
  const d = new Date(now);
  const year = d.getFullYear();
  const month = d.getMonth();
  const count = new Date(year, month + 1, 0).getDate();
  const rand = seeded(`${seed}:${year}-${month}`);
  const todayKey = dayKey(now);
  // A loose spiral, jittered: spreads 28-31 points evenly without overlaps.
  const stars = [];
  const turn = 2.399963; // the golden angle
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.6) / count);
    const a = i * turn + rand() * 0.6;
    const x = 50 + Math.cos(a) * r * 46 + (rand() - 0.5) * 4;
    const y = 30 + Math.sin(a) * r * 26 + (rand() - 0.5) * 3;
    const key = dayKey(new Date(year, month, i + 1));
    stars.push({ day: i + 1, key, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, active: days.has(key), today: key === todayKey, future: key > todayKey, mag: 0.7 + rand() * 0.6 });
  }
  const lit = stars.filter((s) => s.active);
  const links = [];
  for (let i = 1; i < lit.length; i++) links.push([lit[i - 1].day, lit[i].day]);
  const name = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { name, stars, links, lit: lit.length, count };
}

/** The journal: closed days, newest first. */
export function journal(entries = []) {
  return entries.filter((e) => e.closed_at || e.learned || e.win).slice().sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Days since the person's world began, counted from 1. */
export function dayNumber(bornAt, now = Date.now()) {
  const born = Date.parse(bornAt || "");
  if (!Number.isFinite(born)) return 1;
  return Math.max(1, Math.round((startOfDay(now).getTime() - startOfDay(born).getTime()) / DAY) + 1);
}

export { parseDayKey };
