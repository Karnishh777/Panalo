// Panalo Students: the learner model (mastery, memory, pace). Run with
// `node tests/learner.test.mjs`.
import * as L from "../students/js/model/learner.js";

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 1, 4, 30);

// ---- mastery ----
{
  ok("the setup's levels start at 25, 45, 60 and 75%", [1, 2, 3, 4].map((l) => L.mastery(L.newTopic(l))).every((m, i) => near(m, [0.25, 0.45, 0.6, 0.75][i])));
  ok("guessing is allowed for on four-option questions", near(L.pCorrect(L.newTopic(1), 0, 4), 0.25 + 0.75 * 0.25));
  let t = L.newTopic(2);
  const before = L.mastery(t);
  t = L.answer(t, { correct: true });
  ok("a right answer raises mastery", L.mastery(t) > before);
  const up = L.mastery(t) - before;
  let w = L.newTopic(2);
  w = L.answer(w, { correct: false });
  ok("a wrong answer lowers it, by more than a right one raises it (a guess could be lucky)", L.mastery(w) < before && before - L.mastery(w) > up);
  let many = L.newTopic(2);
  for (let i = 0; i < 40; i++) many = L.answer(many, { correct: true });
  const late = L.mastery(L.answer(many, { correct: false })) - L.mastery(many);
  const early = L.mastery(L.answer(L.newTopic(2), { correct: false })) - L.mastery(L.newTopic(2));
  ok("after many answers, one more moves it less", Math.abs(late) < Math.abs(early));
  ok("forty right answers make a topic strong", L.mastery(many) > 0.9);
  let kept = L.newTopic(2);
  for (let i = 0; i < 20; i++) kept = L.answer(kept, { correct: true, now: T0 });
  const soon = L.mastery(L.answer(kept, { correct: false, now: T0 + DAY })) - L.mastery(kept);
  const after = L.mastery(L.answer(kept, { correct: false, now: T0 + 90 * DAY })) - L.mastery(kept);
  ok("after three months away, an answer moves mastery more again", Math.abs(after) > Math.abs(soon) * 1.5);
  let hard = L.answer(L.newTopic(2), { correct: true, difficulty: 1.5 });
  let easy = L.answer(L.newTopic(2), { correct: true, difficulty: -1.5 });
  ok("a hard question right counts for more than an easy one", L.mastery(hard) > L.mastery(easy));
  const marked = L.applyMark(L.newTopic(4), 0.3);
  ok("a poor test mark pulls a 'strong' topic down", L.mastery(marked) < 0.75 && L.mastery(marked) > 0.3);
}

// ---- memory (FSRS-6) ----
{
  ok("recall is 90% after S days, by definition", near(L.recall(5, 5), 0.9, 1e-9));
  ok("the interval for 90% recall is S", near(L.interval(7.5), 7.5, 1e-9));
  ok("a higher target means sooner reviews", L.interval(10, 0.95) < L.interval(10, 0.9));
  ok("scores map to grades", L.gradeOf(0) === 1 && L.gradeOf(0.5) === 2 && L.gradeOf(0.8) === 3 && L.gradeOf(1) === 4);
  let t = L.review(L.newTopic(2), 3, T0);
  ok("a first 'good' check sets stability to the FSRS default (2.3 days)", near(t.S, 2.3065, 1e-6) && t.reps === 1);
  const s1 = t.S;
  t = L.review(t, 3, T0 + 3 * DAY);
  ok("a later 'good' review makes memory last longer", t.S > s1 * 1.5, String(t.S));
  const s2 = t.S;
  const lapse = L.review(t, 1, T0 + 20 * DAY);
  ok("forgetting cuts stability and counts a lapse", lapse.S < s2 && lapse.lapses === 1);
  const easy = L.review(L.review(L.newTopic(2), 3, T0), 4, T0 + 3 * DAY);
  ok("an 'easy' review grows stability more than 'good'", easy.S > s2);
  const same = L.review(L.review(L.newTopic(2), 3, T0), 3, T0 + 2 * 3600000);
  ok("a second check the same day changes little", same.S >= s1 && same.S < s1 * 1.5);
  ok("difficulty stays within 1 and 10", [lapse, easy, same].every((x) => x.D >= 1 && x.D <= 10));
  ok("nothing is due before a first review", L.dueAt(L.newTopic(2)) === null && L.recallNow(L.newTopic(2)) === 1);
  const due = L.dueAt(t, { now: T0 });
  ok("due when recall falls to 90%", near((due - t.last) / DAY, L.interval(t.S), 1e-6));
  const exam = t.last + 10 * DAY;
  ok("an exam close by brings reviews sooner (30% of the 10 days left)", near((L.dueAt(t, { examAt: exam }) - t.last) / DAY, Math.min(L.interval(t.S), 3), 1e-6));
  ok("but never sooner than a day", (L.dueAt(L.review(L.newTopic(2), 1, T0), { examAt: T0 + 2 * DAY }) - T0) / DAY >= 1);
}

// ---- pace ----
{
  let fast = L.newPace();
  let slow = L.newPace();
  // The same 6-hour portion: one student needs 4 h, the other 12 h.
  for (let i = 0; i < 12; i++) {
    fast = L.updatePace(fast, { minutes: 30, typical: 360, covered: 30 / 240 });
    slow = L.updatePace(slow, { minutes: 30, typical: 360, covered: 30 / 720 });
  }
  ok("a fast student's pace settles near 0.67", near(fast.pace, 0.67, 0.05), String(fast.pace));
  ok("a slow student's pace settles near 2", near(slow.pace, 2, 0.1), String(slow.pace));
  const one = L.updatePace(L.newPace(), { minutes: 90, typical: 30, covered: 1 });
  ok("one block can't swing it far (shrunk towards typical)", one.pace < 2, String(one.pace));
  ok("pace stays within 0.5 and 3", L.updatePace({ pace: 2.9, n: 20 }, { minutes: 500, typical: 10, covered: 0.1 }).pace <= 3);
  ok("a block with nothing covered is ignored", L.updatePace(L.newPace(), { minutes: 30, typical: 60, covered: 0 }).n === 0);
  ok("typical time per topic comes from guided learning hours", L.typicalMinutes("igcse", 26) === 150 && L.typicalMinutes("as", 18) === 300);
}

// ---- storage ----
{
  const t = L.review(L.answer(L.newTopic(3), { correct: true, now: T0 }), 3, T0);
  const row = L.toTopicRow("phy", "1.3", { ...t, minutes: 25.4, covered: 1.2 });
  ok("a row has the table's columns, within its checks", row.subject === "phy" && row.topic === "1.3" && row.minutes === 25 && row.covered === 1 && row.last_review === new Date(T0).toISOString());
  const back = L.fromTopicRow(row);
  ok("and reads back the same", Math.abs(back.theta - t.theta) < 1e-9 && back.S === t.S && back.last === T0 && back.seen === T0 && back.n === 1);
  const fresh = L.fromTopicRow({ theta: "0.2", n: 0, covered: 0 });
  ok("a sparse row reads as never reviewed", fresh.S === null && fresh.last === null && fresh.theta === 0.2);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
