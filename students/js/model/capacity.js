// How much self-study a day really has room for (v0.2). Pure
// (tests/capacity.test.mjs). The plan must fit the student's life, not the
// other way round: a plan that over-fills is a plan that gets dropped.
//
//   - Sleep is a hard limit. Teenagers need 8–10 hours; if the profile's
//     bedtime leaves less than 8, the plan ends as if it left 8.
//   - School days: nothing before school; after it, travel home, then a
//     rest before any study. Boarders with a prep time study in prep:
//     it is a fixed slot, so nothing else comes off it.
//   - Coaching (tuition) hours come off first, spread over the week.
//   - Soft caps on self-study, homework included: about 1–2 h for grade 9,
//     up to 3 h for grades 10–12 on school days; more at weekends.
//   - One lighter day a week, and 20% of the week left unplanned for the
//     things nobody can plan (rule 3 of the research report).
import { stageOf } from "./subjects.js";
import { minutesOf } from "./profile.js";

const SLEEP_MIN = 8 * 60; // the hard floor
const MORNING = 60; // wake to ready
const WIND_DOWN = 30; // no study in the last half hour before bed
const REST = 45; // after getting home from school
const MEALS = 60; // dinner and a snack, on any day
const LEISURE = 60; // time that is theirs, every day
export const BUFFER = 0.2; // of the week, left unplanned

/** School-day and other-day caps (minutes) by grade. */
export function caps(grade) {
  if (grade && grade <= 9) return { school: 120, free: 240 };
  return { school: 180, free: 300 };
}

/**
 * The study window and minutes for one weekday (0 = Sunday).
 * Returns { day, school, from, to, minutes, shortSleep }; from/to are
 * minutes since midnight (to may pass 1440 for a late bedtime).
 */
export function dayCapacity(p, day) {
  const wake = minutesOf(p.wakeAt);
  let sleep = minutesOf(p.sleepAt);
  if (sleep <= wake) sleep += 1440;
  const shortSleep = 1440 - (sleep - wake) < SLEEP_MIN;
  const bed = Math.min(sleep, wake + 1440 - SLEEP_MIN);
  const to = bed - WIND_DOWN;

  const school = (p.schoolDays || []).includes(day);
  const travel = p.boarding ? 0 : Math.max(0, p.travelMinutes || 0);
  const from = school ? minutesOf(p.schoolEnd) + travel + REST : wake + MORNING;

  const grade = stageOf(p.stage)?.grade;
  const cap = caps(grade)[school ? "school" : "free"];
  if (school && p.boarding && p.prepStart && p.prepEnd) {
    const ps = minutesOf(p.prepStart);
    const pe = Math.min(minutesOf(p.prepEnd), to);
    return { day, school, from: ps, to: pe, minutes: Math.round(Math.max(0, Math.min(pe - ps, cap))), shortSleep, prep: true };
  }
  const tuition = ((p.tuitionHours || 0) * 60) / 7;
  const open = Math.max(0, to - from - MEALS - LEISURE - tuition);
  return { day, school, from, to, minutes: Math.round(Math.min(open, cap)), shortSleep };
}

/**
 * The week: seven days (index = weekday) with planned minutes after the
 * lighter day and the buffer. The lighter day is the non-school day with
 * the most room (usually Sunday), at half; the buffer comes off every day
 * evenly so no single day is the "catch-up" day.
 */
export function weekCapacity(p) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => dayCapacity(p, d));
  const free = days.filter((d) => !d.school);
  const pool = free.length ? free : days;
  const light = pool.reduce((a, b) => (b.minutes > a.minutes || (b.minutes === a.minutes && b.day === 0) ? b : a)).day;
  return days.map((d) => {
    const raw = d.day === light ? d.minutes / 2 : d.minutes;
    return { ...d, light: d.day === light, planned: Math.round((raw * (1 - BUFFER)) / 5) * 5 };
  });
}

/** Total planned minutes in a week. */
export const weekMinutes = (p) => weekCapacity(p).reduce((n, d) => n + d.planned, 0);
