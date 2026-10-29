// Autopilot (v0.2): the plan changes itself when life does, and says what
// it changed. Nothing here asks the student to fill anything in: a missed
// block, a new event or a tired day reshapes the week by itself, and the
// student sees the difference, with one tap to undo. Pure (tested in Node).
import { dateKey } from "./rules.js";

const DAY = 86400000;
const round5 = (n) => Math.max(0, Math.round(n / 5) * 5);

/** A block's identity across two plans: same subject, topic and kind. */
export const blockKey = (b) => `${b.subject}|${b.topic}|${b.kind}`;

/** A plan (days) as one list of blocks, each with its start as a moment. */
export function flatten(plan) {
  const out = [];
  for (const day of plan || []) for (const b of day.blocks || []) out.push({ ...b, at: day.date + b.start * 60000 });
  return out;
}

/**
 * What changed between two plans, from `now` on: blocks that moved (same
 * block, another time) and blocks that left the week. Blocks already past
 * are left out: they were done, or they are what moved.
 */
export function diffPlans(before, after, { now = Date.now() } = {}) {
  const next = new Map();
  for (const b of flatten(after)) if (!next.has(blockKey(b))) next.set(blockKey(b), b);
  const moved = [];
  const dropped = [];
  const seen = new Set();
  for (const b of flatten(before)) {
    const k = blockKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    const a = next.get(k);
    if (a && a.at !== b.at && a.at >= now) moved.push({ block: a, from: b.at, to: a.at });
    else if (!a && b.at >= now) dropped.push({ block: b, from: b.at });
  }
  moved.sort((x, y) => x.from - y.from);
  return { moved, dropped, kept: seen.size - moved.length - dropped.length };
}

/**
 * Blocks of today's plan (as it was this morning) whose time has gone by
 * with nothing done on their subject since they were due: missed.
 */
export function missed(snapshot, { sessions = [], now = Date.now() } = {}) {
  // A session's subject is what the Study Room was told: an id or a name.
  const done = new Set(sessions.filter((s) => Date.parse(s.started_at) >= startOf(now)).map((s) => String(s.subject || "").toLowerCase()).filter(Boolean));
  const isDone = (b) => done.has(String(b.subject).toLowerCase()) || done.has(String(b.subjectName || "").toLowerCase());
  return (snapshot || []).filter((b) => b.at + b.minutes * 60000 <= now && b.at >= startOf(now) && !isDone(b));
}

const startOf = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** The reasons "Something came up" offers, and what each does to the plan. */
export const REASONS = [
  { id: "class", label: "Extra class" },
  { id: "ill", label: "Feeling ill" },
  { id: "family", label: "Family" },
  { id: "tired", label: "Just tired" },
  { id: "busy", label: "Busy all day" },
];

/**
 * The plan changes for a reason: the rest of today off (and, when ill, a
 * light tomorrow), or, when just tired, a much shorter today.
 */
export function comeUp(reason, { now = Date.now(), plannedToday = 0 } = {}) {
  const today = dateKey(now);
  const tomorrow = dateKey(startOf(now) + DAY + 3600000);
  switch (reason) {
    case "tired":
      return [{ op: "date_minutes", date: today, minutes: Math.max(15, round5(plannedToday * 0.4)) }];
    case "ill":
      return [{ op: "date_off", date: today }, { op: "date_minutes", date: tomorrow, minutes: 45 }];
    case "class":
    case "family":
    case "busy":
      return [{ op: "date_off", date: today }];
    default:
      return [];
  }
}

/** Today's energy, one tap: a lighter or a fuller day, or as planned. */
export const ENERGY = [
  { id: "low", label: "Low" },
  { id: "ok", label: "OK" },
  { id: "high", label: "High" },
];

export function energy(level, { now = Date.now(), plannedToday = 0 } = {}) {
  const today = dateKey(now);
  if (level === "low") return [{ op: "date_minutes", date: today, minutes: Math.max(15, round5(plannedToday * 0.5)) }];
  if (level === "high") return [{ op: "date_minutes", date: today, minutes: Math.min(600, round5(plannedToday + 30)) }];
  return [{ op: "date_clear", date: today }];
}

/** Today's energy as the rules say it (for the chips): low, high or ok. */
export function energyOf(rules, { now = Date.now(), plannedToday = 0 } = {}) {
  const d = rules?.dates?.[dateKey(now)];
  if (!d || d.minutes == null) return "ok";
  return d.minutes < plannedToday ? "low" : d.minutes > plannedToday ? "high" : "ok";
}

/** Monday 00:00 of the week `ms` is in. */
export function weekStart(ms) {
  const d = new Date(startOf(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/**
 * A week looked back, from what was done: minutes studied, days with
 * study, sessions per subject. `sessions` are focus sessions.
 */
export function weekLookBack(sessions, { now = Date.now() } = {}) {
  const from = weekStart(now);
  const mine = sessions.filter((s) => {
    const t = Date.parse(s.started_at);
    return t >= from && t < from + 7 * DAY;
  });
  const days = new Set(mine.map((s) => dateKey(Date.parse(s.started_at))));
  const bySubject = {};
  for (const s of mine) if (s.subject) bySubject[s.subject] = (bySubject[s.subject] || 0) + (s.focused_minutes || 0);
  return { minutes: mine.reduce((n, s) => n + (s.focused_minutes || 0), 0), days: days.size, bySubject };
}

/**
 * Next week's plan, in a few plain sentences: where the time goes, which
 * days are light and why.
 */
export function weekAhead(plan, { nameOf = (s) => s, events = [] } = {}) {
  const per = {};
  const days = (plan || []).map((d) => ({ date: d.date, minutes: d.blocks.reduce((n, b) => n + b.minutes, 0), off: d.off, blocks: d.blocks }));
  for (const d of days) for (const b of d.blocks) per[b.subject] = (per[b.subject] || 0) + b.minutes;
  const total = Object.values(per).reduce((a, b) => a + b, 0);
  const lines = [];
  const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
  if (top && total) lines.push(`${nameOf(top[0])} gets the most time: ${Math.round((top[1] / total) * 100)}% of the week.`);
  const exams = events.filter((e) => e.kind === "exam" && days.length && Date.parse(e.starts_at) >= days[0].date && Date.parse(e.starts_at) < days[days.length - 1].date + DAY);
  for (const e of exams.slice(0, 2)) {
    const before = days.find((d) => d.date + DAY <= Date.parse(e.starts_at) && Date.parse(e.starts_at) - d.date < 2 * DAY);
    lines.push(before ? `${e.title} is ${weekdayName(Date.parse(e.starts_at))}, so ${weekdayName(before.date)} is for going over it.` : `${e.title} is ${weekdayName(Date.parse(e.starts_at))}.`);
  }
  const light = days.filter((d) => !d.off && d.minutes > 0).sort((a, b) => a.minutes - b.minutes)[0];
  if (light && days.length > 2) lines.push(`${weekdayName(light.date)} is the lightest day.`);
  return { total, perSubject: per, days, lines };
}

const weekdayName = (ms) => new Date(ms).toLocaleDateString("en-GB", { weekday: "long" });
