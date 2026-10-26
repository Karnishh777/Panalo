// Panalo Students: the subject check-in. Run with `node tests/diagnose.test.mjs`.
import { readFileSync } from "node:fs";
import { DEFAULTS } from "../students/js/model/profile.js";
import * as P from "../students/js/model/plan.js";
import * as L from "../students/js/model/learner.js";
import * as D from "../students/js/model/diagnose.js";

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));
const load = (p) => JSON.parse(readFileSync(new URL(`../students/${p}`, import.meta.url)));
const NOW = new Date(2026, 9, 19, 16, 0).getTime();
const DAY = 86400000;

// ---- one topic ----
{
  const t = L.newTopic(2);
  ok("a new topic has no rating yet", D.ratingOf(t) === null);
  for (const r of ["untaught", "weak", "okay", "strong"]) ok(`'${r}' reads back as '${r}'`, D.ratingOf(D.rateTopic(t, r, NOW)) === r, D.ratingOf(D.rateTopic(t, r, NOW)));
  const strong = D.rateTopic(t, "strong", NOW);
  const weak = D.rateTopic(t, "weak", NOW);
  ok("strong is reviewed much later than weak", L.dueAt(strong, { now: NOW }) - L.dueAt(weak, { now: NOW }) > 10 * DAY);
  const practised = { ...L.newTopic(2), theta: 1.5, reps: 4, S: 30, last: NOW - DAY, covered: 1, n: 6 };
  const said = D.rateTopic(practised, "weak", NOW);
  ok("practice already done keeps its memory", said.S === 30 && said.last === NOW - DAY);
  ok("…and the student's word moves mastery halfway", said.theta < 1.5 && said.theta > Math.log(0.35 / 0.65));
  const untaught = D.rateTopic(practised, "untaught", NOW);
  ok("'not taught yet' clears the review clock", untaught.covered === 0 && untaught.S == null);
}

// ---- quick check ----
{
  const right = (n, of) => Array.from({ length: of }, (_, i) => ({ correct: i < n }));
  ok("all right lifts okay to strong", D.afterQuickCheck("okay", right(3, 3)) === "strong");
  ok("all wrong drops strong to okay", D.afterQuickCheck("strong", right(0, 3)) === "okay");
  ok("mixed answers keep the rating", D.afterQuickCheck("okay", right(2, 3)) === "okay");
  ok("never drops to 'not taught'", D.afterQuickCheck("weak", right(0, 3)) === "weak");
  ok("one answer isn't enough to change it", D.afterQuickCheck("okay", right(1, 1)) === "okay");
}

// ---- the whole subject, and the plan ----
{
  const profile = { ...DEFAULTS, board: "cambridge", stage: "as", aim: "good", subjects: [{ id: "phy", level: 2 }, { id: "chem", level: 2 }], wakeAt: "06:30", sleepAt: "22:30" };
  const syllabi = {};
  for (const s of profile.subjects) syllabi[s.id] = load(P.syllabusPath(profile.stage, s.id));
  const list = P.topicsInScope(syllabi.phy, profile.stage);
  const half = D.checkOver(list, { taught: 0.5, feel: "okay" });
  const n = Object.values(half).filter((r) => r === "okay").length;
  ok("check-over: half taught rates the first half", n === Math.round(list.length / 2) && half[list[0].id] === "okay" && half[list.at(-1).id] === "untaught");
  ok("check-over: nothing taught", Object.values(D.checkOver(list, { taught: 0, feel: "strong" })).every((r) => r === "untaught"));

  const states = (ratings) => Object.fromEntries(Object.entries(ratings).map(([id, r], i, all) => [id, D.rateTopic(L.newTopic(2), r, NOW, i / all.length)]));
  ok("not checked in until every topic has a state", !D.checkedIn(list, {}) && D.checkedIn(list, states(half)));

  const minutes = (topics) => {
    const plan = P.buildPlan({ profile, syllabi, topics, now: NOW, days: 7 });
    const by = {};
    for (const d of plan) for (const b of d.blocks) by[b.subject] = (by[b.subject] || 0) + b.minutes;
    return { by, plan };
  };
  const chemList = P.topicsInScope(syllabi.chem, profile.stage);
  const weakPhy = minutes({ phy: states(D.checkOver(list, { taught: 1, feel: "weak" })), chem: states(D.checkOver(chemList, { taught: 1, feel: "strong" })) });
  ok("a weak subject gets more time than a strong one", (weakPhy.by.phy || 0) > (weakPhy.by.chem || 0), JSON.stringify(weakPhy.by));
  ok("a strong subject still gets some review this week", (weakPhy.by.chem || 0) > 0, JSON.stringify(weakPhy.by));
  const dues = Object.values(states(D.checkOver(chemList, { taught: 1, feel: "strong" }))).map((t) => Math.floor(L.dueAt(t, { now: NOW }) / DAY));
  ok("reviews from one check-in are spread over many days", new Set(dues).size >= 5, String(new Set(dues).size));
  const untaught = minutes({ phy: states(D.checkOver(list, { taught: 0, feel: "okay" })), chem: states(D.checkOver(chemList, { taught: 1, feel: "okay" })) });
  const kinds = new Set(untaught.plan.flatMap((d) => d.blocks.filter((b) => b.subject === "phy").map((b) => b.kind)));
  ok("a subject not taught yet gets learn blocks, not reviews", kinds.has("learn") && !kinds.has("review"), [...kinds].join());
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`ok - ${passed} check-in checks passed`);
