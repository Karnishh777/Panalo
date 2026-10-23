// The study profile (phase 29): what the setup asks, as the database keeps
// it. Pure (tested in Node): the setup builds a row with toRow(), and the
// planner reads one back with fromRow().
import { stageOf, subjectsFor } from "./subjects.js";

export const DEFAULTS = {
  board: null,
  stage: null,
  subjects: [], // [{ id, level: 1..4, grade?: string }]
  aim: "good",
  schoolDays: [1, 2, 3, 4, 5], // 0 = Sunday
  schoolStart: "08:10",
  schoolEnd: "15:10",
  boarding: false,
  travelMinutes: 30, // each way
  wakeAt: "06:00",
  sleepAt: "22:30",
  tuitionHours: 0, // a week
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
const time = (t, fallback) => (TIME.test(String(t || "").slice(0, 5)) ? String(t).slice(0, 5) : fallback);

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
  const subjects = (a.subjects || [])
    .filter((s) => offered.has(s.id) && !seen.has(s.id) && seen.add(s.id))
    .slice(0, 16)
    .map((s) => ({ id: s.id, level: clamp(s.level ?? 2, 1, 4), ...(s.grade ? { grade: String(s.grade).slice(0, 8) } : {}) }));
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
    wake_at: time(a.wakeAt, DEFAULTS.wakeAt),
    sleep_at: time(a.sleepAt, DEFAULTS.sleepAt),
    tuition_hours: clamp(a.tuitionHours, 0, 40),
    setup_at: now.toISOString(),
  };
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
    wakeAt: time(row.wake_at, DEFAULTS.wakeAt),
    sleepAt: time(row.sleep_at, DEFAULTS.sleepAt),
    tuitionHours: row.tuition_hours ?? DEFAULTS.tuitionHours,
  };
}

/** Whether a profile still needs the setup (never finished it). */
export function needsSetup(row) {
  return !row || !row.setup_at;
}
