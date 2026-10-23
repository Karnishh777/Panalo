// What Panalo knows about how a student learns (v0.2): per topic, how well
// it is known (mastery) and how fast it fades (memory); per subject, how
// long this student takes (pace). Pure (tests/learner.test.mjs).
//
//   Mastery  an Elo rating per topic (Pelánek 2016): P(correct) is a
//            logistic function of mastery minus the question's difficulty,
//            corrected for guessing on multiple choice; each answer moves
//            the rating by K × surprise, with K = 1 / (1 + 0.05 n) so early
//            answers move it a lot and later ones a little. After a long
//            gap the rating is less certain again, so it moves more. Test
//            marks pull it towards the mark.
//   Memory   FSRS-6 (open-spaced-repetition), the best-benchmarked open
//            memory model: stability S in days (recall is 90% after S
//            days), difficulty D in 1..10, published default weights. A
//            check after a block is graded 1..4 from its score.
//   Pace     minutes this student takes ÷ a typical student's, per subject,
//            pulled towards 1 until there is enough data (learning-rate
//            estimates from a few attempts are badly inflated; Koedinger et
//            al. 2023 and its replications), and kept within 0.5..3.

const sigma = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const DAY = 86400000;

// ---- Mastery ---------------------------------------------------------------------------

// Where a topic starts, from the setup's "how is it going" (1 struggling ..
// 4 strong): 25%, 45%, 60%, 75% on a typical question.
const START = { 1: logit(0.25), 2: logit(0.45), 3: logit(0.6), 4: logit(0.75) };

/** A topic's starting state. `level` is the setup's 1..4 for the subject. */
export function newTopic(level = 2) {
  return { theta: START[clamp(Math.round(level), 1, 4)], n: 0, seen: null, S: null, D: null, last: null, reps: 0, lapses: 0, minutes: 0, covered: 0 };
}

/** How well the topic is known: chance of getting a typical question right. */
export const mastery = (t) => sigma(t.theta);

/** Chance of a correct answer to a question of `difficulty` (logits). */
export function pCorrect(t, difficulty = 0, options = 0) {
  const p = sigma(t.theta - difficulty);
  return options > 1 ? 1 / options + (1 - 1 / options) * p : p;
}

/**
 * After one answer at `now` (ms). Returns a new topic state. The answer
 * count behind K fades by half for every month without practice, so a
 * topic left alone can be re-measured quickly.
 */
export function answer(t, { correct, difficulty = 0, options = 4, now = null }) {
  const gap = now != null && t.seen != null ? Math.max(0, (now - t.seen) / DAY) : 0;
  const n = t.n * Math.pow(0.5, gap / 30);
  const K = 1 / (1 + 0.05 * n);
  const p = pCorrect(t, difficulty, options);
  return { ...t, theta: clamp(t.theta + K * ((correct ? 1 : 0) - p), -4, 4), n: n + 1, seen: now ?? t.seen };
}

/**
 * After a test mark (0..1) that covered this topic: mastery moves a third of
 * the way to the mark. Marks are real evidence, but one paper spread over
 * many topics says less about each one.
 */
export function applyMark(t, fraction, weight = 1 / 3) {
  const target = logit(clamp(fraction, 0.05, 0.95));
  return { ...t, theta: t.theta + weight * (target - t.theta) };
}

// ---- Memory (FSRS-6) -------------------------------------------------------------------

export const W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
const DECAY = -W[20];
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

/** Recall probability `days` after the last review, at stability S. */
export function recall(S, days) {
  return Math.pow(1 + (FACTOR * Math.max(0, days)) / S, DECAY);
}

/** Days until recall falls to `target` (0.9 by default). */
export function interval(S, target = 0.9) {
  return (S / FACTOR) * (Math.pow(target, 1 / DECAY) - 1);
}

const d0 = (G) => clamp(W[4] - Math.exp(W[5] * (G - 1)) + 1, 1, 10);

/** A check's score (0..1) as an FSRS grade: 1 again, 2 hard, 3 good, 4 easy. */
export function gradeOf(score) {
  if (score < 0.34) return 1;
  if (score < 0.67) return 2;
  if (score < 1) return 3;
  return 4;
}

/** After a review (a check on the topic) graded G at time `now` (ms). */
export function review(t, G, now) {
  if (t.S == null) {
    return { ...t, S: W[G - 1], D: d0(G), last: now, reps: 1, lapses: G === 1 ? 1 : 0 };
  }
  const days = (now - t.last) / DAY;
  let S;
  if (days < 1) {
    // The same day: a small change only.
    S = Math.max(t.S * Math.exp(W[17] * (G - 3 + W[18])) * Math.pow(t.S, -W[19]), G >= 2 ? t.S : 0.001);
  } else {
    const R = recall(t.S, days);
    if (G === 1) {
      S = Math.min(W[11] * Math.pow(t.D, -W[12]) * (Math.pow(t.S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R)), t.S / Math.exp(W[17] * W[18]));
    } else {
      const hard = G === 2 ? W[15] : 1;
      const easy = G === 4 ? W[16] : 1;
      S = t.S * (Math.exp(W[8]) * (11 - t.D) * Math.pow(t.S, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) * hard * easy + 1);
    }
  }
  const dD = -W[6] * (G - 3);
  const D1 = t.D + (dD * (10 - t.D)) / 9;
  const D = clamp(W[7] * d0(4) + (1 - W[7]) * D1, 1, 10);
  return { ...t, S: Math.max(0.001, S), D, last: now, reps: t.reps + 1, lapses: t.lapses + (G === 1 ? 1 : 0) };
}

/**
 * When the topic is next due for review (ms), or null if never reviewed.
 * Never later than a fraction of the time left before the exam: the best
 * gap shrinks as the test nears (Cepeda et al. 2008: about 20–40% of the
 * time to a test a week away, 5–10% for one a year away).
 */
export function dueAt(t, { examAt = null, now = Date.now(), target = 0.9 } = {}) {
  if (t.S == null || t.last == null) return null;
  let days = Math.max(1, interval(t.S, target));
  if (examAt) {
    const left = (examAt - t.last) / DAY;
    if (left > 0) days = Math.min(days, Math.max(1, left * (left <= 14 ? 0.3 : left <= 90 ? 0.15 : 0.08)));
  }
  return t.last + days * DAY;
}

/** Predicted recall now (1 before the first review: nothing to forget yet). */
export function recallNow(t, now = Date.now()) {
  if (t.S == null || t.last == null) return 1;
  return recall(t.S, (now - t.last) / DAY);
}

// ---- Pace ------------------------------------------------------------------------------

/** A subject's pace: 1 is typical, 2 means twice as long. */
export const newPace = () => ({ pace: 1, n: 0 });

/**
 * After a block: `minutes` spent, `typical` minutes a typical student needs
 * for the whole topic, `covered` the share of it done (0..1). Early blocks
 * count for less (the estimate starts at 1 and moves a third, a quarter,
 * a fifth… of the way), later ones at most a fifth, so one bad day can't
 * swing it.
 */
export function updatePace(p, { minutes, typical, covered }) {
  if (!(minutes > 0 && typical > 0 && covered > 0)) return p;
  const seen = clamp(minutes / (typical * covered), 0.33, 4);
  const alpha = Math.max(0.2, 1 / (p.n + 3));
  return { pace: clamp(p.pace + alpha * (seen - p.pace), 0.5, 3), n: p.n + 1 };
}

// ---- Typical time ----------------------------------------------------------------------

// Cambridge's guided learning hours per syllabus (taught time): IGCSE about
// 130, AS about 180, a full A Level about 360. Independent study is taken
// as half the taught time, shared evenly by the syllabus's topics. This is
// a starting estimate; each student's pace corrects it.
const GLH = { igcse: 130, as: 180, a2: 180, "cbse-secondary": 120, "cbse-senior": 160, other: 120 };

/** A typical student's independent-study minutes for one topic. */
export function typicalMinutes(level, topics) {
  return Math.round(((GLH[level] || 120) * 0.5 * 60) / Math.max(1, topics));
}

// ---- Storage ---------------------------------------------------------------------------

const ms = (v) => (v == null ? null : Date.parse(v));
const iso = (v) => (v == null ? null : new Date(v).toISOString());

/** A topic state from a student_topics row (phase 30). */
export function fromTopicRow(r) {
  return {
    theta: Number(r.theta) || 0,
    n: Number(r.n) || 0,
    seen: ms(r.seen),
    S: r.stability == null ? null : Number(r.stability),
    D: r.difficulty == null ? null : Number(r.difficulty),
    last: ms(r.last_review),
    reps: r.reps || 0,
    lapses: r.lapses || 0,
    minutes: r.minutes || 0,
    covered: Number(r.covered) || 0,
  };
}

/** A topic state as a student_topics row, within the table's checks. */
export function toTopicRow(subject, topic, t) {
  return {
    subject,
    topic,
    theta: clamp(t.theta, -4, 4),
    n: clamp(t.n, 0, 100000),
    seen: iso(t.seen),
    stability: t.S == null ? null : clamp(t.S, 0.001, 36500),
    difficulty: t.D == null ? null : clamp(t.D, 1, 10),
    last_review: iso(t.last),
    reps: clamp(Math.round(t.reps || 0), 0, 100000),
    lapses: clamp(Math.round(t.lapses || 0), 0, 100000),
    minutes: clamp(Math.round(t.minutes || 0), 0, 100000),
    covered: clamp(t.covered || 0, 0, 1),
  };
}
