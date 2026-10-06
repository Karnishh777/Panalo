// The calendar as data: timetable slots and dated entries become concrete
// occurrences in a range, and occurrences become arcs on the day orbit.
//
// Pure (tests/students-model.test.mjs).
import { DAY, HOUR, startOfDay, addDays, dayFraction } from "./time.js";

export const EVENT_KINDS = {
  class: { label: "Class", tone: "time" },
  study: { label: "Study block", tone: "focus" },
  deadline: { label: "Deadline", tone: "alert" },
  event: { label: "Event", tone: "signal" },
  personal: { label: "Personal", tone: "world" },
  exam: { label: "Exam", tone: "drift" },
};

// How long an entry without an end lasts on the orbit. A deadline is a
// moment; anything else is assumed to take an hour.
function durationOf(ev) {
  const start = Date.parse(ev.starts_at);
  const end = ev.ends_at ? Date.parse(ev.ends_at) : NaN;
  if (Number.isFinite(end) && end > start) return end - start;
  return ev.kind === "deadline" ? 0 : HOUR;
}

/**
 * Every occurrence that overlaps [from, to), sorted by start.
 * A weekly entry repeats on the same weekday and local time from its first
 * date onward, with no end -- that is what a timetable slot is.
 * Tasks with a due date are passed in as deadline-shaped rows by the caller.
 */
export function occurrencesBetween(events, from, to) {
  const lo = new Date(from).getTime();
  const hi = new Date(to).getTime();
  const out = [];
  for (const ev of events || []) {
    const first = new Date(ev.starts_at);
    if (Number.isNaN(first.getTime())) continue;
    const dur = durationOf(ev);
    if (!ev.repeat_weekly) {
      const s = first.getTime();
      if (s < hi && s + Math.max(dur, 1) > lo) out.push({ event: ev, start: new Date(s), end: new Date(s + dur) });
      continue;
    }
    // Walk weeks by calendar date (not by adding 7*24h), so a slot keeps
    // its local time across a daylight-saving change.
    const firstDay = startOfDay(first);
    const offsetInDay = first.getTime() - firstDay.getTime();
    const weeksToStart = Math.max(0, Math.floor((startOfDay(lo).getTime() - firstDay.getTime()) / (7 * DAY)) - 1);
    for (let w = weeksToStart; ; w++) {
      const day = addDays(firstDay, w * 7);
      const s = day.getTime() + offsetInDay;
      if (s >= hi) break;
      if (s < first.getTime()) continue;
      if (s + Math.max(dur, 1) > lo) out.push({ event: ev, start: new Date(s), end: new Date(s + dur) });
      if (w > weeksToStart + 600) break; // a range of more than ten years is a bug upstream
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function occurrencesOnDay(events, day) {
  const s = startOfDay(day);
  return occurrencesBetween(events, s, addDays(s, 1));
}

// The part of an occurrence that falls on `day`, as fractions of that day
// (0 = midnight). A deadline is a point: a0 === a1.
export function arcOnDay(occ, day) {
  const s = startOfDay(day).getTime();
  const e = addDays(new Date(s), 1).getTime();
  const a = Math.max(occ.start.getTime(), s);
  const b = Math.min(occ.end.getTime(), e);
  return {
    a0: a >= e ? 1 : dayFraction(a),
    a1: b >= e ? 1 : b <= s ? 0 : dayFraction(b),
  };
}

// The next thing that has not started yet, or the thing happening now.
export function nextUp(events, now = Date.now()) {
  const occ = occurrencesBetween(events, now - 12 * HOUR, now + 8 * DAY);
  const current = occ.find((o) => o.start.getTime() <= now && o.end.getTime() > now);
  const next = occ.find((o) => o.start.getTime() > now) || null;
  return { current: current || null, next };
}

// Turn tasks with a due date into deadline-shaped rows the calendar can
// place alongside everything else.
export function tasksAsDeadlines(tasks) {
  return (tasks || [])
    .filter((t) => t.due_at && !t.done_at)
    .map((t) => ({
      id: `task:${t.id}`,
      title: t.title,
      kind: "deadline",
      starts_at: t.due_at,
      ends_at: null,
      repeat_weekly: false,
      _task: t,
    }));
}

/**
 * Exams coming up in the next `days` days, soonest first, with whole days to
 * go (0 = today). Weekly entries count their next occurrence.
 */
export function countdowns(events, now = Date.now(), days = 60) {
  const from = new Date(now);
  const until = new Date(now + days * 86400000);
  return occurrencesBetween(events.filter((e) => e.kind === "exam"), from, until)
    .filter((o) => o.start.getTime() >= now - 3600000)
    .map((o) => {
      const d0 = new Date(now);
      d0.setHours(0, 0, 0, 0);
      const d1 = new Date(o.start);
      d1.setHours(0, 0, 0, 0);
      return { title: o.event.title, at: o.start, days: Math.round((d1 - d0) / 86400000), event: o.event };
    })
    .sort((a, b) => a.at - b.at);
}
