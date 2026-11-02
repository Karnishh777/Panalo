// The study profile (phase 29): what the setup asks, as the database keeps
// it. Pure (tested in Node): the setup builds a row with toRow(), and the
// planner reads one back with fromRow().
import { stageOf, subjectsFor } from "./subjects.js";
import { cleanCustomSubject, cleanCustomSyllabi, MAX_CUSTOM } from "./custom.js";

export const DEFAULTS = {
  board: null,
  stage: null,
  // [{ id, level: 1..4, grade?, papers?: ["1", "5"], series?: "2027-fm", dates?: { "1": "2027-03-02" } }]
  subjects: [],
  aim: "good",
  schoolDays: [1, 2, 3, 4, 5], // 0 = Sunday
  schoolStart: "08:10",
  schoolEnd: "15:10",
  boarding: false,
  travelMinutes: 30, // each way
  prepStart: "18:00", // boarders: the school's evening prep
  prepEnd: "19:30",
  // Boarders (phase 36): every study time the school keeps, on its days
  // (evening prep, morning prep, night study, weekend prep); the plan uses
  // them in full. [{ start: "HH:MM", end: "HH:MM", days: [0..6] }]
  prepSlots: [],
  weekend: "stay", // boarders: weekends in the hostel ("stay"), at home ("home"), or asked each week ("ask")
  homeTravel: 60, // boarders going home: minutes each way
  wakeAt: "06:00",
  sleepAt: "22:00", // 8 hours after a 06:00 wake: the planner never plans into less
  tuitionHours: 0, // a week, for coaching without fixed times
  activities: [], // [{ kind, name, days: [0..6], start: "HH:MM", end: "HH:MM" }] (phase 34)
  customSyllabi: {}, // { subjectId: { name, code, board, known, topics: [{ id, name, stage? }] } } (phase 35)
  routine: {}, // a more detailed day (phase 39): see cleanRoutine
};

// The areas of life a week can keep time for (model/world-model.js LIFE).
export const LIFE_GOALS = ["connect", "move", "read", "rest", "create", "outdoors", "help"];
export const BEST_TIMES = ["any", "morning", "afternoon", "evening"];
export const FOCUS = [25, 40, 50];

/**
 * A more detailed day (phase 39), cleaned:
 *   weekendWake, weekendSleep  "HH:MM" on days without school, or null (as on school days)
 *   dinnerAt                   "HH:MM", or null (meals are an hour somewhere in the day)
 *   dinnerMinutes              15..120 (45)
 *   best                       when to study on days without school (BEST_TIMES)
 *   focus                      minutes of study before a break (FOCUS)
 *   goals                      { area: minutes a week, 0..1200 } for LIFE_GOALS
 */
export function cleanRoutine(r) {
  const x = r && typeof r === "object" && !Array.isArray(r) ? r : {};
  const goals = {};
  for (const k of LIFE_GOALS) {
    const m = clamp(x.goals?.[k], 0, 1200);
    if (m > 0) goals[k] = Math.round(m / 5) * 5;
  }
  return {
    weekendWake: time(x.weekendWake, null),
    weekendSleep: time(x.weekendSleep, null),
    dinnerAt: time(x.dinnerAt, null),
    dinnerMinutes: clamp(x.dinnerMinutes ?? 45, 15, 120),
    best: BEST_TIMES.includes(x.best) ? x.best : "any",
    focus: FOCUS.includes(Number(x.focus)) ? Number(x.focus) : 25,
    goals,
  };
}

export const ACTIVITY_KINDS = [
  ["coaching", "Coaching"],
  ["sport", "Sport"],
  ["art", "Art"],
  ["music", "Music"],
  ["other", "Other"],
];

/**
 * Sports, art, coaching and the like at fixed times (phase 34): cleaned,
 * at most 12, each on real weekdays with an end after its start.
 */
export function cleanActivities(list) {
  const kinds = new Set(ACTIVITY_KINDS.map(([k]) => k));
  return (Array.isArray(list) ? list : [])
    .map((x) => ({
      kind: kinds.has(x?.kind) ? x.kind : "other",
      name: String(x?.name || "").trim().slice(0, 40),
      days: [...new Set((x?.days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
      start: time(x?.start, ""),
      end: time(x?.end, ""),
    }))
    .filter((x) => x.days.length && x.start && x.end && x.end > x.start)
    .slice(0, 12);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
const time = (t, fallback) => (TIME.test(String(t || "").slice(0, 5)) ? String(t).slice(0, 5) : fallback);

export const WEEKENDS = ["stay", "home", "ask"];
export const MAX_PREP = 6;

/** A boarder's study times: cleaned, at most six, each on real days. */
export function cleanPrepSlots(list) {
  return (Array.isArray(list) ? list : [])
    .map((x) => ({
      start: time(x?.start, ""),
      end: time(x?.end, ""),
      days: [...new Set((x?.days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
    }))
    .filter((x) => x.days.length && x.start && x.end && x.end > x.start)
    .slice(0, MAX_PREP);
}

/**
 * A boarder's study times, or [] for a day scholar. Profiles from before
 * phase 36 have one evening prep: it counts on school days.
 */
export function prepSlotsOf(a) {
  if (!a?.boarding) return [];
  if (a.prepSlots?.length) return cleanPrepSlots(a.prepSlots);
  return a.prepStart && a.prepEnd && a.prepEnd > a.prepStart ? [{ start: a.prepStart, end: a.prepEnd, days: [...(a.schoolDays || [])].sort() }] : [];
}

/** Minutes since midnight for "HH:MM". */
export function minutesOf(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

/**
 * The answers as a student_profiles row (only the phase 29 columns, plus
 * setup_at). Anything out of range is clamped; unknown subjects dropped.
 */
export function toRow(a, now = new Date()) {
  const stage = stageOf(a.stage) ? a.stage : null;
  const offered = new Set(subjectsFor(stage).map((s) => s.id));
  const seen = new Set();
  // Listed subjects, and up to six of the student's own ("other subjects").
  let custom = 0;
  const subjects = (a.subjects || [])
    .map((s) => (offered.has(s.id) ? { s, own: null } : { s, own: cleanCustomSubject(s) }))
    .filter(({ s, own }) => (offered.has(s.id) || (own && custom++ < MAX_CUSTOM)) && !seen.has(s.id) && seen.add(s.id))
    .slice(0, 16)
    .map(({ s, own }) => ({ id: s.id, ...(own || {}), level: clamp(s.level ?? 2, 1, 4), ...(s.grade ? { grade: String(s.grade).slice(0, 8) } : {}), ...(own ? {} : cleanPapers(s)) }));
  const days = [...new Set((a.schoolDays || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return {
    board: ["cambridge", "cbse", "other"].includes(a.board) ? a.board : null,
    stage,
    subjects,
    aim: ["pass", "good", "top"].includes(a.aim) ? a.aim : null,
    school_days: days,
    school_start: time(a.schoolStart, DEFAULTS.schoolStart),
    school_end: time(a.schoolEnd, DEFAULTS.schoolEnd),
    boarding: !!a.boarding,
    travel_minutes: a.boarding ? 0 : clamp(a.travelMinutes, 0, 240),
    ...prepOf(a),
    prep_slots: a.boarding ? cleanPrepSlots(a.prepSlots) : [],
    weekend_plan: a.boarding ? (WEEKENDS.includes(a.weekend) ? a.weekend : "stay") : null,
    home_travel_minutes: a.boarding ? clamp(a.homeTravel ?? DEFAULTS.homeTravel, 0, 720) : null,
    wake_at: time(a.wakeAt, DEFAULTS.wakeAt),
    sleep_at: time(a.sleepAt, DEFAULTS.sleepAt),
    tuition_hours: clamp(a.tuitionHours, 0, 40),
    activities: cleanActivities(a.activities),
    custom_syllabi: cleanCustomSyllabi(a.customSyllabi, subjects.filter((s) => s.custom).map((s) => s.id)),
    routine: cleanRoutine(a.routine),
    setup_at: now.toISOString(),
  };
}

// Prep time (phase 31): only for boarders, and only a real slot. Since
// phase 36 it mirrors the first study time, for older versions of the app.
function prepOf(a) {
  if (!a.boarding) return { prep_start: null, prep_end: null };
  const first = cleanPrepSlots(a.prepSlots)[0];
  const start = time(first?.start ?? a.prepStart, DEFAULTS.prepStart);
  const end = time(first?.end ?? a.prepEnd, DEFAULTS.prepEnd);
  return end > start ? { prep_start: start, prep_end: end } : { prep_start: null, prep_end: null };
}

/**
 * A subject's papers, series and paper dates (model/papers.js), kept small:
 * the whole subjects list has 4 KB in the database.
 */
export function cleanPapers(s) {
  const out = {};
  const ids = [...new Set((Array.isArray(s.papers) ? s.papers : []).map(String).filter((x) => /^[0-9]{1,2}$/.test(x)))].slice(0, 8);
  if (ids.length) out.papers = ids;
  if (/^20[2-9][0-9]-(fm|mj|on)$/.test(s.series || "")) out.series = s.series;
  const dates = {};
  for (const [k, v] of Object.entries(s.dates && typeof s.dates === "object" ? s.dates : {})) {
    if (ids.includes(k) && /^20[2-9][0-9]-[01][0-9]-[0-3][0-9]$/.test(v)) dates[k] = v;
  }
  if (Object.keys(dates).length) out.dates = dates;
  return out;
}

/** A saved row back as answers (for the planner, or to edit the setup). */
export function fromRow(row) {
  if (!row) return { ...DEFAULTS };
  return {
    board: row.board ?? DEFAULTS.board,
    stage: row.stage ?? DEFAULTS.stage,
    subjects: Array.isArray(row.subjects) ? row.subjects : [],
    aim: row.aim ?? DEFAULTS.aim,
    schoolDays: Array.isArray(row.school_days) ? row.school_days.map(Number) : DEFAULTS.schoolDays,
    schoolStart: time(row.school_start, DEFAULTS.schoolStart),
    schoolEnd: time(row.school_end, DEFAULTS.schoolEnd),
    boarding: !!row.boarding,
    travelMinutes: row.travel_minutes ?? DEFAULTS.travelMinutes,
    prepStart: row.prep_start ? time(row.prep_start, null) : null,
    prepEnd: row.prep_end ? time(row.prep_end, null) : null,
    prepSlots: cleanPrepSlots(row.prep_slots),
    weekend: WEEKENDS.includes(row.weekend_plan) ? row.weekend_plan : DEFAULTS.weekend,
    homeTravel: row.home_travel_minutes ?? DEFAULTS.homeTravel,
    wakeAt: time(row.wake_at, DEFAULTS.wakeAt),
    sleepAt: time(row.sleep_at, DEFAULTS.sleepAt),
    tuitionHours: row.tuition_hours ?? DEFAULTS.tuitionHours,
    activities: cleanActivities(row.activities),
    customSyllabi: row.custom_syllabi && typeof row.custom_syllabi === "object" ? row.custom_syllabi : {},
    routine: cleanRoutine(row.routine),
  };
}

/** Whether a profile still needs the setup (never finished it). */
export function needsSetup(row) {
  return !row || !row.setup_at;
}
