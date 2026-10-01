// Time helpers shared by the world, the calendar and Now.
//
// Pure: no DOM, no network. Every function takes `now` (or a Date) from the
// caller so it can be tested at any moment (tests/students-model.test.mjs).

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Weeks start on Monday, the way school timetables do.
export function startOfWeek(d) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  return addDays(x, -dow);
}

export function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

// A local calendar day as YYYY-MM-DD (the format of a Postgres `date`).
export function dayKey(d) {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
}

// Parse a YYYY-MM-DD as a LOCAL day (new Date("2026-10-01") would be UTC).
export function parseDayKey(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// "in 40 min", "in 2 h 5 min", "now", "12 min ago".
export function relTime(targetMs, now = Date.now()) {
  const diff = targetMs - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "now";
  const mins = Math.round(abs / MINUTE);
  let text;
  if (mins < 60) text = `${mins} min`;
  else if (mins < 60 * 48) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    text = m ? `${h} h ${m} min` : `${h} h`;
  } else text = `${Math.round(mins / 1440)} days`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

// 95 → "1 h 35 min", 40 → "40 min", 0 → "0 min".
export function formatMinutes(total) {
  const m = Math.max(0, Math.round(total));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

// Where in the day an instant falls, 0 at midnight and 1 at the next.
export function dayFraction(d) {
  const x = new Date(d);
  return (x.getHours() * 3600 + x.getMinutes() * 60 + x.getSeconds()) / 86400;
}

export function clockTime(d) {
  const x = new Date(d);
  return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
}
