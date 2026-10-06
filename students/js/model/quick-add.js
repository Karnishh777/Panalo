// Quick add (batch 3): type a line, get a calendar entry.
//
//   "Physics test fri 10am"          an exam, this Friday at 10:00
//   "Maths class every mon 9-10"     a weekly class, Mondays 9 to 10
//   "Essay due 12/10"                a deadline, 12 October, end of the day
//   "Robotics club tomorrow 4:30pm"  an event, tomorrow at 16:30
//
// Dates are read the way India writes them (12/10 is the 12th of October).
// Anything it can't place lands today, or the next sensible time, and the
// full form is always one tap away. Returns null for an empty line.
//
// Pure (tests/students-model.test.mjs).
import { startOfDay, addDays } from "./time.js";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_RE = "(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const KINDS = [
  ["exam", /\b(exams?|tests?|quiz(?:zes)?|mid-?terms?|finals?|olympiad|boards?|viva|paper\s*\d)\b/i],
  ["deadline", /\b(due|deadline|submit|submission|hand\s*in)\b/i],
  ["class", /\b(class|classes|lecture|lesson|tuition|lab|practical|period)\b/i],
  ["study", /\b(study|revise|revision|homework)\b/i],
];

function to24(h, m, ap) {
  let hh = Number(h);
  const mm = Number(m || 0);
  if (ap) {
    ap = ap.toLowerCase();
    if (ap.startsWith("p") && hh < 12) hh += 12;
    if (ap.startsWith("a") && hh === 12) hh = 0;
  }
  if (hh > 23 || mm > 59) return null;
  return [hh, mm];
}

/**
 * @returns {{title: string, kind: string, start: Date, end: Date|null, repeat_weekly: boolean, timed: boolean} | null}
 */
export function parseQuickAdd(input, now = Date.now()) {
  let text = ` ${String(input || "").trim()} `;
  if (!text.trim()) return null;
  const today = startOfDay(now);
  let date = null;
  let repeat = false;
  let start = null;
  let end = null;
  const cut = (re) => {
    const m = text.match(re);
    if (m) text = text.replace(m[0], " ");
    return m;
  };

  // Times first (so "10" in "10am" isn't read as a date). A bare hour under
  // 8 with no am/pm is the afternoon: school days don't start at 3 a.m.
  const AP = "(am|pm|a\\.m\\.|p\\.m\\.)";
  const bare = (h) => (Number(h) < 8 ? Number(h) + 12 : Number(h));
  let m;
  const range = text.match(new RegExp(`\\s(?:at\\s+|from\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*${AP}?\\s*(?:-|–|to)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*${AP}?(?=\\s)`, "i"));
  if (range) {
    const [, h1, m1, a1, h2, m2, a2] = range;
    const marked = a1 || a2 || m1 || m2;
    // "12-10" with nothing else is a date (12 October), not a time.
    if (marked || Number(h1) < Number(h2)) {
      text = text.replace(range[0], " ");
      const ap1 = a1 || (a2 && Number(h1) <= Number(h2) ? a2 : null);
      start = ap1 || m1 ? to24(h1, m1, ap1) : [bare(h1), 0];
      end = a2 || m2 ? to24(h2, m2, a2) : [bare(h2), 0];
    }
  }
  if (!start) {
    m = cut(new RegExp(`\\s(?:at\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*${AP}(?=\\s)`, "i")) || cut(/\s(?:at\s+)?(\d{1,2})[:.](\d{2})(?=\s)/i);
    if (m) start = to24(m[1], m[2], m[3]);
    else if ((m = cut(/\sat\s+(\d{1,2})(?=\s)/i))) start = [bare(m[1]), 0];
  }
  if (cut(/\s(noon|midday)(?=\s)/i)) start = [12, 0];
  if (cut(/\s(tonight)(?=\s)/i)) {
    date = today;
    start = start || [20, 0];
  }

  // Dates.
  if ((m = cut(new RegExp(`\\s(?:every|each)\\s+${DAY_RE}s?(?=\\s)`, "i")))) {
    repeat = true;
    const want = DAYS.indexOf(m[1].slice(0, 3).toLowerCase());
    const diff = (want - today.getDay() + 7) % 7;
    date = addDays(today, diff);
  } else if (cut(/\s(today)(?=\s)/i)) {
    date = today;
  } else if (cut(/\s(tomorrow|tmrw|tmr)(?=\s)/i)) {
    date = addDays(today, 1);
  } else if ((m = cut(new RegExp(`\\s(?:on\\s+)?(next\\s+)?${DAY_RE}(?=\\s)`, "i")))) {
    const want = DAYS.indexOf(m[2].slice(0, 3).toLowerCase());
    let diff = (want - today.getDay() + 7) % 7;
    if (m[1] && diff === 0) diff = 7; // "next friday" on a Friday
    date = addDays(today, diff);
  } else if ((m = cut(new RegExp(`\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}(?=\\s)`, "i")) || cut(new RegExp(`\\s(?:on\\s+)?${MON_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?=\\s)`, "i")))) {
    const numFirst = /^\d/.test(m[1]);
    const d = Number(numFirst ? m[1] : m[2]);
    const mon = MONTHS.indexOf((numFirst ? m[2] : m[1]).slice(0, 3).toLowerCase());
    date = new Date(today.getFullYear(), mon, d);
    if (date < today) date = new Date(today.getFullYear() + 1, mon, d);
  } else if ((m = cut(/\s(?:on\s+)?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?=\s)/))) {
    const d = Number(m[1]);
    const mon = Number(m[2]) - 1;
    let y = m[3] ? Number(m[3]) : today.getFullYear();
    if (y < 100) y += 2000;
    date = new Date(y, mon, d);
    if (!m[3] && date < today) date = new Date(y + 1, mon, d);
    if (date.getMonth() !== mon) date = null; // 31/02 and the like
  } else if ((m = cut(/\s(?:on\s+the\s+|on\s+)?(\d{1,2})(?:st|nd|rd|th)(?=\s)/i))) {
    const d = Number(m[1]);
    date = new Date(today.getFullYear(), today.getMonth(), d);
    if (date < today) date = new Date(today.getFullYear(), today.getMonth() + 1, d);
  }

  // What kind of thing it is: from the words, before they're tidied.
  const all = String(input);
  let kind = "event";
  for (const [k, re] of KINDS) {
    if (re.test(all)) {
      kind = k;
      break;
    }
  }
  if (repeat && kind === "event") kind = "class";

  // The title: what's left, minus filler.
  let title = text
    .replace(/\s(at|on|from|by|this|next|every)(?=\s)/gi, " ")
    .replace(/\s(due|deadline)(?=\s*$)/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) title = kind === "exam" ? "Exam" : kind === "deadline" ? "Deadline" : "Untitled";
  title = title.charAt(0).toUpperCase() + title.slice(1);

  const timed = !!start;
  const day = date || today;
  const s = new Date(day);
  if (start) s.setHours(start[0], start[1], 0, 0);
  else if (kind === "deadline") s.setHours(23, 59, 0, 0);
  else s.setHours(9, 0, 0, 0);
  // A time that's already passed today, with no date given, means tomorrow.
  if (!date && timed && s.getTime() < now) s.setDate(s.getDate() + 1);
  let e = null;
  if (end && kind !== "deadline") {
    e = new Date(s);
    e.setHours(end[0], end[1], 0, 0);
    if (e <= s) e = new Date(e.getTime() + 24 * 3600000);
  }
  return { title: title.slice(0, 120), kind, start: s, end: e, repeat_weekly: repeat && kind !== "deadline", timed };
}
