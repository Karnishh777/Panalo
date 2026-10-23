// Panalo Students: the weekly plan. Run with `node tests/plan.test.mjs`.
import { readFileSync } from "node:fs";
import { DEFAULTS } from "../students/js/model/profile.js";
import * as P from "../students/js/model/plan.js";
import * as L from "../students/js/model/learner.js";

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));
const load = (p) => JSON.parse(readFileSync(new URL(`../students/${p}`, import.meta.url)));
const DAY = 86400000;
// Monday 19 October 2026, 16:00 local time.
const NOW = new Date(2026, 9, 19, 16, 0).getTime();

const profile = {
  ...DEFAULTS,
  board: "cambridge",
  stage: "as",
  aim: "good",
  subjects: [{ id: "phy", level: 2 }, { id: "chem", level: 3 }, { id: "math", level: 1 }],
  wakeAt: "06:30",
  sleepAt: "22:30",
  travelMinutes: 30,
};
const syllabi = {};
for (const s of profile.subjects) syllabi[s.id] = load(P.syllabusPath(profile.stage, s.id));

// ---- where things live, and what is in scope ----
{
  ok("IGCSE and A Level banks have their own folders", P.syllabusPath("igcse2", "phy") === "assets/syllabus/igcse/phy.json" && P.syllabusPath("a2", "phy") === "assets/syllabus/alevel/phy.json");
  ok("CBSE has no bank yet", P.syllabusPath("cbse10", "phy") === null);
  const as = P.topicsInScope(syllabi.phy, "as");
  const a2 = P.topicsInScope(syllabi.phy, "a2");
  ok("AS students study the AS topics only", as.length > 0 && as.every((t) => t.stage === "as"));
  ok("A2 students have all of it", a2.length > as.length);
  ok("a subject with no bank becomes one 'own work' topic", P.topicsInScope(null, "cbse10")[0].id === "*");
  const exam = P.nextExam({ id: "phy", name: "Physics", code: "9702" }, [{ kind: "exam", title: "Physics test", starts_at: new Date(NOW + 9 * DAY).toISOString() }, { kind: "exam", title: "Chemistry test", starts_at: new Date(NOW + 2 * DAY).toISOString() }], NOW);
  ok("exams are matched to subjects by name", exam === NOW + 9 * DAY);
}

// ---- a brand-new student ----
{
  const plan = P.buildPlan({ profile, syllabi, now: NOW });
  ok("a week of days", plan.length === 7);
  const today = plan[0];
  ok("today starts no earlier than now", today.from >= 16 * 60);
  ok("today has blocks", today.blocks.length > 0);
  ok("a new student starts with quick checks, in syllabus order", today.blocks.every((b) => b.kind === "check") && today.blocks.some((b) => b.subject === "phy" && b.topic === syllabi.phy.topics[0].id), JSON.stringify(today.blocks.map((b) => b.kind + b.subject + b.topic)));
  ok("the struggling subject comes first", today.blocks[0].subject === "math", today.blocks[0].subject);
  const all = plan.flatMap((d) => d.blocks);
  ok("checks lead to learning later in the week", all.some((b) => b.kind === "learn"));
  ok("every day fits its capacity", plan.every((d) => d.minutes + d.blocks.length * 5 <= d.planned + 5 || d === plan[0]), JSON.stringify(plan.map((d) => [d.minutes, d.planned])));
  ok("no subject takes more than half a day", plan.every((d) => ["phy", "chem", "math"].every((s) => d.blocks.filter((b) => b.subject === s).reduce((n, b) => n + b.minutes, 0) <= Math.max(50, d.planned / 2))));
  ok("days are well used", plan.slice(1).every((d) => d.minutes + d.blocks.length * 5 >= d.planned - 30), JSON.stringify(plan.map((d) => [d.minutes, d.planned])));
  ok("no topic twice in a day", plan.every((d) => new Set(d.blocks.map((b) => b.subject + b.topic)).size === d.blocks.length));
  ok("blocks have start times, with breaks between", today.blocks.every((b, i) => i === 0 || b.start >= today.blocks[i - 1].start + today.blocks[i - 1].minutes + 5));
  ok("blocks end before bedtime", plan.every((d) => d.blocks.every((b) => b.start + b.minutes <= d.to + 5)));
  ok("the next block is today's first", P.nextBlock(plan) === today.blocks[0]);
  const late = P.buildPlan({ profile, syllabi, now: new Date(2026, 9, 19, 22, 10).getTime() });
  ok("nothing is planned for tonight after the study window", late[0].blocks.length === 0);
  const done = P.buildPlan({ profile, syllabi, now: NOW, doneToday: 600 });
  ok("time already studied today comes off today", done[0].blocks.length === 0);
}

// ---- after checks: known topics review, gaps get learned ----
{
  const first = syllabi.phy.topics[0].id;
  const second = syllabi.phy.topics[1].id;
  let known = P.afterBlock(L.newTopic(2), { kind: "check", answers: [{ correct: true }, { correct: true }, { correct: true }], minutes: 10, now: NOW });
  let gap = P.afterBlock(L.newTopic(2), { kind: "check", answers: [{ correct: false }, { correct: true }, { correct: false }], minutes: 10, now: NOW });
  ok("a good check marks the topic as known and starts its memory", known.covered === 1 && known.S != null);
  ok("a poor check leaves it to learn, and starts no memory yet", gap.covered === 0 && gap.S == null && gap.n === 3);
  const plan = P.buildPlan({ profile, syllabi, topics: { phy: { [first]: known, [second]: gap } }, now: NOW + 3 * DAY, days: 10 });
  const phy = plan.flatMap((d) => d.blocks).filter((b) => b.subject === "phy");
  ok("the gap is learned", phy.some((b) => b.topic === second && b.kind === "learn"));
  ok("the known topic comes back as a review", phy.some((b) => b.topic === first && b.kind === "review"), JSON.stringify(phy.map((b) => b.kind + b.topic)));
  const learned = P.afterBlock(gap, { kind: "learn", answers: [{ correct: true }, { correct: true }], covered: 0.5, minutes: 25, now: NOW + DAY });
  ok("half-learned: covered moves, memory waits", learned.covered === 0.5 && learned.S == null && learned.minutes === 35);
  const fully = P.afterBlock(learned, { kind: "learn", answers: [{ correct: true }, { correct: true }], covered: 1, minutes: 25, now: NOW + 2 * DAY });
  ok("fully learned: its memory starts", fully.covered === 1 && fully.S != null);
  const own = P.afterBlock(L.newTopic(2), { kind: "practice", rating: 3, minutes: 25, now: NOW });
  ok("own-work blocks are rated instead of checked", own.S != null && own.n === 0);
}

// ---- exams ----
{
  const exam = new Date(NOW + 1.5 * DAY);
  exam.setHours(9, 0, 0, 0);
  const events = [{ kind: "exam", title: "Physics test", starts_at: exam.toISOString() }];
  const plan = P.buildPlan({ profile, syllabi, events, now: NOW });
  const phyToday = plan[0].blocks.filter((b) => b.subject === "phy");
  ok("nothing new in a subject two days before its exam", phyToday.every((b) => b.kind === "review" || b.kind === "practice"));
  ok("nothing at all for it on the exam day", plan[2].blocks.every((b) => b.subject !== "phy"), JSON.stringify(plan[2].blocks.map((b) => b.subject)));
  const reviewed = {};
  for (const t of P.topicsInScope(syllabi.phy, "as").slice(0, 4)) reviewed[t.id] = L.review({ ...L.newTopic(3), covered: 1 }, 3, NOW - 20 * DAY);
  const soon = P.buildPlan({ profile, syllabi, topics: { phy: reviewed }, events, now: NOW });
  ok("before an exam, covered topics come back for review", soon[0].blocks.some((b) => b.subject === "phy" && b.kind === "review"));
}

// ---- subjects with no question bank ----
{
  const cbse = { ...DEFAULTS, board: "cbse", stage: "cbse10", subjects: [{ id: "phy", level: 2 }, { id: "eng", level: 3 }] };
  const plan = P.buildPlan({ profile: cbse, syllabi: {}, now: NOW });
  const all = plan.flatMap((d) => d.blocks);
  ok("without a bank, subjects still get blocks of their own work", all.length > 0 && all.every((b) => b.topic === "*" && b.kind === "practice" && b.own));
  ok("and at most one block a day for each", plan.every((d) => new Set(d.blocks.map((b) => b.subject)).size === d.blocks.length));
}

// ---- results and readiness ----
{
  const ids = P.topicsInScope(syllabi.phy, "as").map((t) => t.id);
  const states = Object.fromEntries(ids.map((id) => [id, L.newTopic(3)]));
  const before = P.readiness(P.topicsInScope(syllabi.phy, "as"), states);
  const after = P.applyResult(states, 0.35, ids.slice(0, 3));
  ok("a poor mark lowers the topics it covered", L.mastery(after[ids[0]]) < L.mastery(states[ids[0]]) && after[ids[5]] === states[ids[5]]);
  ok("readiness is the mean mastery", P.readiness(P.topicsInScope(syllabi.phy, "as"), after) < before && Math.abs(before - 0.6) < 0.01);
  ok("estimates are padded 1.5× until there is data", P.pad(null) === 1.5 && P.pad({ n: 5 }) === 1);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
