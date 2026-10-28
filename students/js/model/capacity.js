// How much self-study a day really has room for (v0.2). Pure
// (tests/capacity.test.mjs). The plan must fit the student's life, not the
// other way round: a plan that over-fills is a plan that gets dropped.
//
//   - Sleep is a hard limit. Teenagers need 8–10 hours; if the profile's
//     bedtime leaves less than 8, the plan ends as if it left 8.
//   - School days: nothing before school; after it, travel home, then a
//     rest before any study. Boarders study in their study times (evening
//     prep, morning prep, night study: phase 36): the school keeps them for
//     study, so they are used in full, with no buffer off them.
//   - Boarders' weekends: in the hostel, a free day with any weekend prep;
//     going home, the evening before is travel, and the last day ends
//     early for the journey back.
//   - Coaching (tuition) hours come off first, spread over the week.
//   - Fixed activities (sport, art, coaching at set times) come off their
//     days, with a little time to get there and back; the planner also
//     never puts a block over them (busyOf, plan.js).
//   - Soft caps on self-study, homework included: about 1–2 h for grade 9,
//     up to 3 h for grades 10–12 on school days; more at weekends.
//   - One lighter day a week, and 20% of the week left unplanned for the
//     things nobody can plan (rule 3 of the research report).
import { stageOf } from "./subjects.js";
import { minutesOf, prepSlotsOf } from "./profile.js";

const SLEEP_MIN = 8 * 60; // the hard floor
const MORNING = 60; // wake to ready
const WIND_DOWN = 30; // no study in the last half hour before bed
const REST = 45; // after getting home from school
const MEALS = 60; // dinner and a snack, on any day
const LEISURE = 60; // time that is theirs, every day
export const BUFFER = 0.2; // of the week, left unplanned
const GETTING_THERE = 15; // before and after a fixed activity
const SETTLE = 30; // after a journey home or back
const DAY_MS = 86400000;

/** A boarder's study times on a weekday, as [start, end] minutes, in order. */
export function prepOn(p, day) {
  return prepSlotsOf(p)
    .filter((s) => s.days.includes(day))
    .map((s) => [minutesOf(s.start), minutesOf(s.end)])
    .sort((x, y) => x[0] - y[0])
    .reduce((out, [a, b]) => {
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
      return out;
    }, []);
}

/**
 * The fixed activities on a weekday, as busy intervals (minutes since
 * midnight), padded for getting there and back.
 */
export function activitiesOn(p, day) {
  return (p.activities || [])
    .filter((a) => a.days.includes(day))
    .map((a) => [minutesOf(a.start) - GETTING_THERE, minutesOf(a.end) + GETTING_THERE]);
}

/** Minutes of [from, to] covered by busy intervals (which may overlap). */
export function busyWithin(busy, from, to) {
  const xs = busy.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of xs) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

/** School-day and other-day caps (minutes) by grade. */
export function caps(grade) {
  if (grade && grade <= 9) return { school: 120, free: 240 };
  return { school: 180, free: 300 };
}

/**
 * The study window and minutes for one weekday (0 = Sunday).
 * Returns { day, school, from, to, minutes, fixed, windows?, shortSleep };
 * from/to are minutes since midnight (to may pass 1440 for a late
 * bedtime). `fixed` is the part of `minutes` in a boarder's study times
 * (used in full); `windows`, when set, are the only times to study in.
 * For boarders, `o` says where the weekend is: { where: "stay" | "home" }
 * on a day without school, { leaving: true } on a school day before a
 * weekend at home, { returning: true } on the last day of one.
 */
export function dayCapacity(p, day, o = {}) {
  const wake = minutesOf(p.wakeAt);
  let sleep = minutesOf(p.sleepAt);
  if (sleep <= wake) sleep += 1440;
  const shortSleep = 1440 - (sleep - wake) < SLEEP_MIN;
  const bed = Math.min(sleep, wake + 1440 - SLEEP_MIN);
  const to = bed - WIND_DOWN;

  const school = (p.schoolDays || []).includes(day);
  const grade = stageOf(p.stage)?.grade;
  const cap = caps(grade)[school ? "school" : "free"];
  const tuition = ((p.tuitionHours || 0) * 60) / 7;
  const base = { day, school, to, shortSleep, fixed: 0 };
  // Free time from `from` to `end`, after meals, leisure, coaching and
  // fixed activities, up to the day's cap.
  const open = (from, end, less = 0) => Math.round(Math.max(0, Math.min(end - from - MEALS - LEISURE - tuition - busyWithin(activitiesOn(p, day), from, end) - less, cap)));

  if (p.boarding) {
    const home = Math.max(0, p.homeTravel ?? 60);
    if (school && o.leaving) {
      const from = minutesOf(p.schoolEnd) + home + REST;
      return { ...base, from, minutes: open(from, to), travel: home };
    }
    const prep = prepOn(p, day).map(([a, b]) => [a, Math.min(b, to)]).filter(([a, b]) => b > a);
    const fixed = prep.reduce((n, [a, b]) => n + b - a, 0);
    if (school && prep.length) return { ...base, from: prep[0][0], to: prep[prep.length - 1][1], minutes: Math.min(fixed, 300), fixed: Math.min(fixed, 300), windows: prep, prep: true };
    if (!school && o.where === "home") {
      const from = wake + MORNING;
      const end = o.returning ? to - home - SETTLE : to;
      return { ...base, from, to: end, minutes: open(from, end), where: "home", travel: o.returning ? home : 0 };
    }
    if (!school) {
      // In the hostel: weekend prep in full, and free time around it.
      const from = wake + MORNING;
      const flex = Math.max(0, open(from, to) - fixed);
      return { ...base, from, minutes: fixed + flex, fixed, where: "stay", prep: fixed > 0 };
    }
    const from = minutesOf(p.schoolEnd) + REST;
    return { ...base, from, minutes: open(from, to) };
  }
  const travel = Math.max(0, p.travelMinutes || 0);
  const from = school ? minutesOf(p.schoolEnd) + travel + REST : wake + MORNING;
  return { ...base, from, minutes: open(from, to) };
}

/**
 * Planned minutes for a day: its study times in full, and the rest of its
 * time halved on the lighter day, less the buffer.
 */
export function plannedOf(d, light) {
  const flex = Math.max(0, d.minutes - (d.fixed || 0));
  return (d.fixed || 0) + Math.round((flex * (light ? 0.5 : 1) * (1 - BUFFER)) / 5) * 5;
}

/**
 * The week: seven days (index = weekday) with planned minutes after the
 * lighter day and the buffer. The lighter day is the non-school day with
 * the most room (usually Sunday), at half; the buffer comes off every day
 * evenly so no single day is the "catch-up" day.
 */
export function weekCapacity(p) {
  const where = p.boarding && p.weekend === "home" ? "home" : "stay";
  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => dayCapacity(p, d, { where }));
  const light = lightDay(days);
  return days.map((d) => ({ ...d, light: d.day === light, planned: plannedOf(d, d.day === light) }));
}

// The lighter day: the non-school day with the most room (Sunday on a tie).
function lightDay(days) {
  const free = days.filter((d) => !d.school);
  const pool = free.length ? free : days;
  return pool.reduce((a, b) => (b.minutes > a.minutes || (b.minutes === a.minutes && b.day === 0) ? b : a)).day;
}

/**
 * One date's capacity, with a boarder's weekend: `whereOf(ms)` says
 * "home" or "stay" for a day without school (the student's answer for
 * that weekend, or their usual).
 */
export function dateCapacity(p, ms, whereOf = () => null) {
  const day = new Date(ms).getDay();
  const school = (d) => (p.schoolDays || []).includes(d);
  const usual = p.boarding && p.weekend === "home" ? "home" : "stay";
  const where = (t) => whereOf(t) || usual;
  const o = {};
  if (p.boarding) {
    if (school(day)) o.leaving = !school((day + 1) % 7) && where(ms + DAY_MS) === "home";
    else {
      o.where = where(ms);
      o.returning = o.where === "home" && school((day + 1) % 7);
    }
  }
  const d = dayCapacity(p, day, o);
  const light = lightDay([0, 1, 2, 3, 4, 5, 6].map((x) => dayCapacity(p, x, { where: usual }))) === day;
  return { ...d, light, planned: plannedOf(d, light) };
}

/** Total planned minutes in a week. */
export const weekMinutes = (p) => weekCapacity(p).reduce((n, d) => n + d.planned, 0);
