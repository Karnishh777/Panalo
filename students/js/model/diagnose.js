// A subject check-in (v0.2): what a student says about a subject turned
// into the topic states the planner works from. Pure (tests/diagnose.test.mjs).
//
// Two ways in, and the student picks:
//   check-over  one answer for the whole subject: how much school has taught
//               so far and how it's going. The taught part (syllabus order)
//               takes that rating; the rest is "not taught yet".
//   chapters    a rating per chapter, optionally with a quick check (a few
//               questions from the bank) that corrects the rating.
//
// What each rating means to the planner:
//   untaught  nothing to review yet: learn blocks when there is room
//   weak      known a little (35% on a typical question), reviewed soon
//   okay      60%, reviewed within a week
//   strong    82%, reviewed in about three weeks
// A topic already practised in the app keeps its memory; the student's word
// moves its mastery halfway (their answers so far are evidence too).
import * as L from "./learner.js";

export const RATINGS = [
  { id: "untaught", label: "Not taught yet" },
  { id: "weak", label: "Weak" },
  { id: "okay", label: "Okay" },
  { id: "strong", label: "Strong" },
];

export const TAUGHT = [
  [0, "Not started"],
  [0.25, "About a quarter"],
  [0.5, "About half"],
  [0.75, "Most of it"],
  [1, "All of it"],
];

const SAID = {
  weak: { p: 0.35, S: 2, D: 7 },
  okay: { p: 0.6, S: 6, D: 5 },
  strong: { p: 0.82, S: 20, D: 3 },
};
const logit = (p) => Math.log(p / (1 - p));

const DAY = 86400000;

/**
 * A topic's state after the student rates it. `spread` (0..1) staggers the
 * first reviews: a whole subject rated at once would otherwise all fall due
 * on the same day, so each topic's memory is dated a little earlier.
 */
export function rateTopic(t, rating, now = Date.now(), spread = 0) {
  if (rating === "untaught") return { ...t, covered: 0, n: Math.max(1, t.n), seen: t.seen ?? now, S: null, D: null, last: null };
  const s = SAID[rating];
  if (!s) return t;
  const target = logit(s.p);
  if (t.reps > 0) return { ...t, covered: 1, theta: (t.theta + target) / 2, n: Math.max(t.n, 2) };
  const last = now - Math.round(Math.min(1, Math.max(0, spread)) * 0.8 * s.S) * DAY;
  return { ...t, covered: 1, theta: target, n: Math.max(t.n, 2), seen: now, S: s.S, D: s.D, last };
}

/** The whole subject at once: { topicId: rating } in syllabus order. */
export function checkOver(list, { taught, feel }) {
  const n = Math.round(list.length * Math.min(1, Math.max(0, taught)));
  return Object.fromEntries(list.map((tp, i) => [tp.id, i < n ? feel : "untaught"]));
}

/**
 * A quick check's answers correct a rating: mostly right lifts it one step,
 * mostly wrong drops it one (never to "not taught"). Two or more answers.
 */
export function afterQuickCheck(rating, answers) {
  if (rating === "untaught" || answers.length < 2) return rating;
  const share = answers.filter((a) => a.correct).length / answers.length;
  const order = ["weak", "okay", "strong"];
  const i = order.indexOf(rating);
  if (share >= 0.8 && i < 2) return order[i + 1];
  if (share <= 0.34 && i > 0) return order[i - 1];
  return rating;
}

/** What a topic looks like now, as a rating (for showing the sheet again). */
export function ratingOf(t) {
  if (!t || (t.n === 0 && t.covered === 0 && t.S == null)) return null;
  if (t.covered < 1) return "untaught";
  const m = L.mastery(t);
  return m < 0.475 ? "weak" : m < 0.71 ? "okay" : "strong";
}

/** Whether a subject has had its check-in: every topic in scope has a state. */
export function checkedIn(list, states) {
  return list.length > 0 && list.every((tp) => states?.[tp.id]);
}

