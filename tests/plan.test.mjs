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
  ok("ICSE banks have their own folder; ISC has none yet", P.syllabusPath("icse9", "phy") === "assets/syllabus/icse/phy.json" && P.syllabusPath("isc12", "phy") === null);
  const years = { code: "icse-phy", topics: [{ id: "9.1", stage: "9", name: "a" }, { id: "10.1", stage: "10", name: "b" }, { id: "x", name: "c" }] };
  ok("an ICSE class studies its own year's chapters", P.topicsInScope(years, "icse9").map((t) => t.id).join() === "9.1,x" && P.topicsInScope(years, "icse10").map((t) => t.id).join() === "10.1,x");
  ok("…with its paper chosen too", P.topicsInScope(years, "icse10", ["1"]).map((t) => t.id).join() === "10.1,x");
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
  ok("every day fits its capacity", plan.every((d) => d.minutes <= d.planned || d === plan[0]), JSON.stringify(plan.map((d) => [d.minutes, d.planned])));
  ok("no subject takes more than half a day", plan.every((d) => ["phy", "chem", "math"].every((s) => d.blocks.filter((b) => b.subject === s).reduce((n, b) => n + b.minutes, 0) <= Math.max(50, d.planned / 2))));
  ok("days are well used", plan.slice(1).every((d) => d.minutes + d.blocks.length * 5 >= d.planned - 30 && d.minutes <= d.planned), JSON.stringify(plan.map((d) => [d.minutes, d.planned])));
  ok("no topic twice in a day", plan.every((d) => new Set(d.blocks.map((b) => b.subject + b.topic)).size === d.blocks.length));
  ok("blocks have start times, with a break after each long one", plan.every((d) => d.blocks.every((b, i) => i === 0 || b.start >= d.blocks[i - 1].start + d.blocks[i - 1].minutes + (d.blocks[i - 1].minutes >= 25 ? 5 : 0))));
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
  ok("nothing new in a subject two days before its exam", phyToday.every((b) => b.kind === "review" || b.kind === "practice" || b.kind === "topical"));
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

// ---- a boarder: blocks inside study times; a weekend at home ----
{
  const boarder = { ...profile, boarding: true, schoolDays: [1, 2, 3, 4, 5, 6], wakeAt: "06:00", sleepAt: "22:00", prepSlots: [{ start: "06:15", end: "07:00", days: [1, 2, 3, 4, 5, 6] }, { start: "18:00", end: "19:30", days: [1, 2, 3, 4, 5, 6] }], homeTravel: 60, routine: { homework: 0 } };
  const morning = new Date(2026, 9, 20, 5, 0).getTime(); // Tuesday 05:00
  const plan = P.buildPlan({ profile: boarder, syllabi, now: morning });
  const inside = (d, b) => [[375, 420], [1080, 1170]].some(([a, z]) => b.start >= a && b.start + b.minutes <= z);
  ok("a boarder's blocks sit inside their study times", plan.filter((d) => d.prep).every((d) => d.blocks.every((b) => inside(d, b))), JSON.stringify(plan[0].blocks.map((b) => [b.start, b.minutes])));
  ok("study times are well used", plan.filter((d) => d.prep).every((d) => d.minutes >= 90), JSON.stringify(plan.map((d) => d.minutes)));
  const rules = { off: [], minutes: {}, start: null, weight: {}, dates: {}, skips: [], pins: [], away: { "2026-10-25": "home" } };
  const sun = new Date(2026, 9, 24, 5, 0).getTime(); // Saturday 05:00
  const home = P.buildPlan({ profile: boarder, syllabi, now: sun, days: 2, rules });
  ok("the day of going home has no prep, only an evening after the journey", !home[0].prep && home[0].travel === 60 && home[0].blocks.every((b) => b.start >= 15 * 60 + 10 + 60 + 45));
  ok("at home on Sunday, back before bed", home[1].where === "home" && home[1].blocks.every((b) => b.start + b.minutes <= 21 * 60 + 30 - 90));
  const stay = P.buildPlan({ profile: boarder, syllabi, now: sun, days: 2 });
  ok("staying in the hostel keeps Saturday's prep", stay[0].prep && stay[1].where === "stay");
}

// A more detailed day (phase 39): dinner kept free, longer focus, life.
{
  const routine = { dinnerAt: "19:00", dinnerMinutes: 45, focus: 50, goals: { read: 210 } };
  const plan = P.buildPlan({ profile: { ...profile, routine }, syllabi, now: NOW, days: 3 });
  const blocks = plan.flatMap((d) => d.blocks);
  ok("no block over dinner", blocks.every((b) => b.start + b.minutes <= 19 * 60 || b.start >= 19 * 60 + 45), JSON.stringify(blocks.map((b) => [b.start, b.minutes])));
  ok("each day lists its areas of life", plan.every((d) => d.life.some((x) => x.kind === "read" && x.minutes === 30)));
  const gaps = [];
  for (const d of plan) for (let k = 1; k < d.blocks.length; k++) gaps.push(d.blocks[k].start - d.blocks[k - 1].start - d.blocks[k - 1].minutes);
  ok("a 50-minute focus earns a 10-minute break", gaps.includes(10) && !gaps.some((g) => g > 0 && g < 10 && g !== 5), JSON.stringify(gaps));
  const short = P.buildPlan({ profile, syllabi, now: NOW, days: 1 })[0];
  ok("without a routine, nothing changes", short.life.length === 0);
}

// Exam days (the review): the subject rests on its exam day, the sitting is
// busy, the evening before is a light review, and nothing after the last.
{
  const NOW2 = new Date(2026, 10, 4, 16).getTime(); // Wed 4 Nov 2026
  const prof = { ...profile, subjects: [{ id: "phy", level: 2, papers: ["2"], dates: { "2": "2026-11-07" } }, { id: "chem", level: 3 }] };
  const plan = P.buildPlan({ profile: prof, syllabi, now: NOW2, days: 6 });
  const on = (dd) => plan.find((x) => new Date(x.date).getDate() === dd);
  const sat = on(7), fri = on(6), sun = on(8);
  ok("nothing for a subject on its exam day", sat && !sat.blocks.some((b) => b.subject === "phy"), JSON.stringify(sat?.blocks.map((b) => b.subject)));
  ok("…and study that day starts after the sitting", sat && sat.blocks.every((b) => b.start >= 9 * 60 + 30), JSON.stringify(sat?.blocks.map((b) => b.start)));
  const eve = fri.blocks.filter((b) => b.subject === "phy");
  ok("the evening before: two short reviews at most", eve.length <= 2 && eve.every((b) => b.kind === "review"), JSON.stringify(eve.map((b) => b.kind)));
  ok("after the last paper, the subject is done", sun && !sun.blocks.some((b) => b.subject === "phy"));
  ok("calendar exams match whole words", P.nextExam({ id: "cs", name: "Computer Science", code: "0478" }, [{ kind: "exam", title: "Physics test", starts_at: new Date(NOW2 + DAY).toISOString() }], NOW2) === null && P.nextExam({ id: "math", name: "Mathematics", code: "0580" }, [{ kind: "exam", title: "Maths unit test", starts_at: new Date(NOW2 + DAY).toISOString() }], NOW2) != null);
}

// A weak topic that's due gets practice, not another short review.
{
  const weak = L.review({ ...L.newTopic(1), covered: 1, n: 3, theta: -1.5 }, 1, NOW - 10 * DAY);
  const n = P.need(weak, { at: NOW, target: 0.75, examAt: null, level: 1, firstNew: false });
  ok("a weak, due topic is practised", n?.kind === "practice", JSON.stringify(n));
}

// Repeated questions don't earn an Easy (phase 41).
{
  const t = { ...L.newTopic(2), covered: 1 };
  const fresh = P.afterBlock(t, { kind: "review", answers: [{ correct: true, id: "a" }, { correct: true, id: "b" }], now: NOW });
  const repeats = P.afterBlock(t, { kind: "review", answers: [{ correct: true, id: "a", repeat: true }, { correct: true, id: "b", repeat: true }], now: NOW });
  ok("all right on repeats is Good, not Easy: a shorter interval", repeats.S < fresh.S, `${repeats.S} vs ${fresh.S}`);
  ok("the questions asked are remembered", fresh.asked.map((x) => x[0]).join() === "a,b");
}

// Topical blocks: a chapter's exam-style questions on one paper, timed.
{
  const kin = syllabi.phy.topics.find((t) => t.id === "2");
  const set = P.topicalSet(kin, { code: "9702" });
  ok("a topical set takes the chapter's exam-style questions", set && set.count >= 1 && set.keys.every((k) => k.startsWith("2#")), JSON.stringify(set));
  ok("…its marks add up", set && set.marks === set.keys.reduce((n, k) => n + kin.long[Number(k.split("#")[1])].marks, 0));
  ok("…its minutes are 15 to 50, in fives", set && set.minutes >= 15 && set.minutes <= 50 && set.minutes % 5 === 0, String(set?.minutes));
  ok("…all from one paper", set && set.keys.every((k) => kin.long[Number(k.split("#")[1])].paper === set.paper));
  ok("a paper the student doesn't sit gives no set", P.topicalSet(kin, { code: "9702", papers: ["5"] }) === null);
  ok("a chapter without exam-style questions gives no set", P.topicalSet({ id: "x", long: [] }, { code: "9702" }) === null);
  const many = { id: "7", long: [1, 2, 3].map((m) => ({ q: `q${m}`, marks: 30, paper: "2", scheme: [] })) };
  const a = P.topicalSet(many);
  const b = P.topicalSet(many, { asked: L.noteAsked([], a.ids, NOW) });
  ok("a long set stops at 50 minutes but keeps at least one question", a.count === 1 && a.minutes === 50, JSON.stringify(a));
  ok("a known paper sets the pace: 9702 P2 is 75 min for 60 marks", P.topicalSet(many, { code: "9702" }).minutes === 45);
  ok("a set names its questions' ids", a.ids.length === a.count && a.ids[0] === L.questionId(many.long[0]));
  ok("questions done lately go to the back, so the next set differs", !a.keys.includes(b.keys[0]), `${a.keys} / ${b.keys}`);
  ok("the same state always gives the same set", JSON.stringify(P.topicalSet(many)) === JSON.stringify(a));

  // A week of topical practice on one chapter works through its questions.
  const six = { id: "1", name: "Forces", questions: [], long: [1, 2, 3, 4, 5, 6].map((m) => ({ q: `Force question ${m}`, marks: 12, paper: "2", scheme: [] })) };
  const week = P.buildPlan({ profile: { ...profile, subjects: [{ id: "zz", level: 2 }] }, syllabi: { zz: { name: "Mechanics", topics: [six] } }, topics: { zz: { 1: L.review({ ...L.newTopic(2), covered: 1, n: 4, theta: 0.6 }, 3, NOW - 12 * DAY) } }, now: NOW, days: 7 });
  const sets = week.flatMap((d) => d.blocks).filter((bk) => bk.kind === "topical");
  ok("a chapter's next topical set uses questions not yet done", sets.length >= 2 && !sets[1].qs.some((k) => sets[0].qs.includes(k)), JSON.stringify(sets.map((bk) => bk.qs)));

  ok("chapters: numbers read 'Ch n', codes stay as they are", P.chapterOf("2") === "Ch 2" && P.chapterOf("3.1") === "Ch 3.1" && P.chapterOf("P1.2") === "P1.2" && P.chapterOf("*") === "");
  const block = { kind: "topical", subject: "phy", subjectName: "Physics", topic: "2", topicName: "Kinematics", chapter: "Ch 2", paper: "2", count: 3, marks: 12, minutes: 25 };
  ok("a topical block says exactly what to do", P.blockLabel(block) === "Physics P2 · Ch 2 Kinematics · topical Q1–3 (12 marks) · 25 min", P.blockLabel(block));
  ok("…and a one-question set says Q1", P.blockTask({ ...block, count: 1, marks: 4 }) === "topical Q1 (4 marks)");
  ok("other blocks name their chapter too", P.blockLabel({ ...block, kind: "practice", paper: undefined, count: undefined, marks: undefined }) === "Physics · Ch 2 Kinematics · Practise · 25 min");
  ok("own-work blocks keep the subject alone", P.blockTitle({ own: true, subjectName: "History", topicName: "Your own work", kind: "practice" }) === "History");

  // A student who has learnt most of AS physics, its paper 2 in three weeks.
  const learnt = {};
  for (const t of P.topicsInScope(syllabi.phy, "as")) learnt[t.id] = L.review({ ...L.newTopic(2), covered: 1, n: 4, theta: 0.6 }, 3, NOW - 12 * DAY);
  const prof = { ...profile, subjects: [{ id: "phy", level: 2, papers: ["2"], dates: { "2": "2026-11-09" } }] };
  const plan = P.buildPlan({ profile: prof, syllabi, topics: { phy: learnt }, now: NOW, days: 7 });
  const topicals = plan.flatMap((d) => d.blocks).filter((bk) => bk.kind === "topical");
  ok("near an exam, learnt chapters get topical blocks", topicals.length > 0, JSON.stringify(plan.flatMap((d) => d.blocks).map((bk) => bk.kind + bk.topic)));
  ok("…on the paper the student sits", topicals.every((bk) => bk.paper === "2"));
  ok("…with real questions from the bank", topicals.every((bk) => bk.qs.length === bk.count && bk.qs.every((k) => syllabi.phy.topics.find((t) => t.id === bk.topic).long[Number(k.split("#")[1])])));
  ok("…and the minutes of their set", topicals.every((bk) => bk.minutes >= 15 && bk.minutes <= 50 && bk.minutes % 5 === 0));
  ok("every block carries its chapter", plan.flatMap((d) => d.blocks).every((bk) => bk.chapter === P.chapterOf(bk.topic) || bk.kind === "paper"));

  const pinned = P.buildPlan({ profile: prof, syllabi, topics: { phy: learnt }, now: NOW, days: 1, rules: { off: [], minutes: {}, start: null, weight: {}, dates: {}, skips: [], away: {}, pins: [{ date: "2026-10-19", subject: "phy", topic: "2", kind: "topical" }] } });
  const moved = pinned[0].blocks.find((bk) => bk.pinned);
  ok("a topical block moved to today keeps its set and minutes", moved?.kind === "topical" && moved.qs?.length >= 1 && moved.minutes >= 15, JSON.stringify(moved));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
