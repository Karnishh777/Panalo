// Panalo Students: papers, exam series and planning by paper. Run with `node tests/papers.test.mjs`.
import { readFileSync } from "node:fs";
import { DEFAULTS, toRow, cleanPapers } from "../students/js/model/profile.js";
import * as P from "../students/js/model/plan.js";
import * as PP from "../students/js/model/papers.js";

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));
const load = (p) => JSON.parse(readFileSync(new URL(`../students/${p}`, import.meta.url)));
const math = load(P.syllabusPath("as", "math"));
const phy = load(P.syllabusPath("as", "phy"));
const DAY = 86400000;

// ---- the papers ----
{
  const ids = (list) => list.map((t) => t.id);
  const p15 = ids(P.topicsInScope(math, "as", ["1", "5"]));
  ok("9709 Papers 1 and 5: Pure 1 and Probability & Statistics 1 only", p15.every((id) => /^(P1|S1)\./.test(id)) && p15.includes("S1.5") && p15.includes("P1.8") && p15.length === 13, p15.join());
  const p12 = ids(P.topicsInScope(math, "as", ["1", "2"]));
  ok("9709 Paper 2 is Pure 2 (the first six Pure 3 sections)", p12.includes("P3.6") && !p12.includes("P3.7") && !p12.some((id) => id.startsWith("S1")), p12.join());
  ok("no papers chosen: the AS half as before", ids(P.topicsInScope(math, "as")).includes("M1.1") && !ids(P.topicsInScope(math, "as")).includes("P3.1"));
  ok("9702 Papers 1, 2 and 3 examine every AS topic", P.topicsInScope(phy, "as", ["1", "2", "3"]).length === phy.topics.filter((t) => t.stage !== "a2").length);
  ok("the usual AS route for 9709 is Papers 1 and 5", PP.defaultPapers("9709", "as").join() === "1,5");
  ok("AS students are offered only AS papers", PP.papersForLevel("9709", "as").map((p) => p.id).join() === "1,2,4,5");
  ok("every paper names a kind and examines at least one topic", Object.entries(PP.SYLLABUS_PAPERS).every(([code, s]) => s.papers.every((p) => ["mcq", "written", "practical"].includes(p.kind))));
  ok("a paper's label", PP.paperLabel(PP.paperOf("9709", "5")) === "Paper 5 · Probability & Statistics 1");
  // every paper of every bank examines something
  const banks = { 9709: math, 9702: phy };
  for (const [code, bank] of Object.entries(banks)) for (const p of PP.papersOf(code)) ok(`${code} paper ${p.id} examines topics`, PP.paperTopics(bank, p).length > 0);
}

// ---- series and dates ----
{
  const fm = new Date(PP.seriesStart("2027-fm"));
  ok("February/March 2027 starts late February", fm.getFullYear() === 2027 && fm.getMonth() === 1 && fm.getDate() === 23);
  ok("series labels", PP.seriesLabel("2027-fm") === "February/March 2027");
  const next = PP.upcomingSeries(new Date(2026, 9, 27).getTime());
  ok("upcoming series from late October 2026", next.join() === "2026-on,2027-fm,2027-mj,2027-on", next.join());
  const s = { series: "2027-fm", dates: { 5: "2027-03-10" } };
  ok("a paper's own date wins over its series", new Date(PP.paperDate(s, "5")).getDate() === 10 && new Date(PP.paperDate(s, "1")).getDate() === 23);
}

// ---- the profile keeps them, cleaned ----
{
  const c = cleanPapers({ papers: ["1", "5", "5", "x", "123"], series: "2027-fm", dates: { 1: "2027-03-02", 9: "2027-03-03", 5: "soon" } });
  ok("papers, series and dates are cleaned", c.papers.join() === "1,5" && c.series === "2027-fm" && Object.keys(c.dates).join() === "1", JSON.stringify(c));
  ok("a bad series is dropped", !("series" in cleanPapers({ series: "2027-xx" })));
  const row = toRow({ ...DEFAULTS, board: "cambridge", stage: "as", subjects: [{ id: "math", level: 2, papers: ["1", "5"], series: "2027-fm" }] });
  ok("toRow keeps a subject's papers and series", row.subjects[0].papers.join() === "1,5" && row.subjects[0].series === "2027-fm");
  ok("…and stays within the database's 4 KB", JSON.stringify(toRow({ ...DEFAULTS, board: "cambridge", stage: "as", subjects: ["math", "phy", "chem", "bio", "cs", "eco"].map((id) => ({ id, papers: ["1", "2", "3", "4", "5"], series: "2027-fm", dates: { 1: "2027-03-01", 2: "2027-03-02", 3: "2027-03-03", 4: "2027-03-04", 5: "2027-03-05" } })) }).subjects).length < 2000);
}

// ---- planning by paper ----
{
  const profile = { ...DEFAULTS, board: "cambridge", stage: "as", aim: "good", wakeAt: "06:30", sleepAt: "22:30", subjects: [{ id: "math", level: 2, papers: ["1", "5"], series: "2027-fm", dates: { 1: "2027-03-02", 5: "2027-03-10" } }, { id: "phy", level: 2, papers: ["1", "2", "3"], series: "2027-fm" }] };
  const syllabi = { math, phy };
  const now = new Date(2027, 0, 30, 15, 0).getTime(); // a Saturday, 31 days before Paper 1
  const plan = P.buildPlan({ profile, syllabi, now, days: 7 });
  const blocks = plan.flatMap((d) => d.blocks);
  ok("only the chosen papers' topics are planned", blocks.filter((b) => b.subject === "math" && b.kind !== "paper").every((b) => /^(P1|S1)\./.test(b.topic)), blocks.filter((b) => b.subject === "math").map((b) => b.topic).join());
  const papers = blocks.filter((b) => b.kind === "paper");
  ok("timed past papers come in as the papers near", papers.length >= 1, String(papers.length));
  ok("a past paper is as long as the paper, plus marking", papers.every((b) => b.minutes === Math.min(180, Math.ceil(((PP.paperOf(syllabi[b.subject].code, b.paper).minutes || 90) + 15) / 5) * 5)));
  ok("never more than one past paper a day", plan.every((d) => d.blocks.filter((b) => b.kind === "paper").length <= 1));
  const recent = { math: { 1: now - DAY, 5: now - DAY }, phy: { 1: now - DAY, 2: now - DAY, 3: now - DAY } };
  const later = P.buildPlan({ profile, syllabi, now, days: 3, papersDone: recent });
  ok("a paper done yesterday isn't planned again so soon", !later.flatMap((d) => d.blocks).some((b) => b.kind === "paper"));
  const far = P.buildPlan({ profile, syllabi, now: new Date(2026, 10, 1, 15).getTime(), days: 7 });
  ok("months away, no past papers yet", !far.flatMap((d) => d.blocks).some((b) => b.kind === "paper"));
  const { examOf } = P.paperPlan(profile.subjects[0], math, P.topicsInScope(math, "as", ["1", "5"]), now);
  ok("each topic counts down to its own paper", new Date(examOf["S1.3"]).getDate() === 10 && new Date(examOf["P1.1"]).getDate() === 2);
}

// ---- exam-style questions: well-formed, on the right paper, diagrams present ----
{
  const { existsSync, readdirSync } = await import("node:fs");
  let n = 0;
  for (const dir of ["alevel", "igcse"]) {
    for (const f of readdirSync(new URL(`../students/assets/syllabus/${dir}/`, import.meta.url))) {
      const bank = load(`assets/syllabus/${dir}/${f}`);
      for (const t of bank.topics) {
        for (const q of t.long || []) {
          n++;
          const where = `${bank.code} ${t.id}: ${q.q.slice(0, 40)}`;
          ok(`${where}: marks = scheme lines`, q.marks === q.scheme.length && q.marks > 0);
          const paper = PP.paperOf(bank.code, q.paper);
          ok(`${where}: its paper exists and examines the topic`, paper && PP.paperTopics(bank, paper).some((x) => x.id === t.id));
          ok(`${where}: every scheme line names its mark`, q.scheme.every((x) => /^[MABC]\d: /.test(x)));
          if (q.fig) ok(`${where}: its diagram exists`, existsSync(new URL(`../students/${q.fig}`, import.meta.url)));
        }
      }
    }
  }
  ok("there are exam-style questions", n >= 50, String(n));
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`ok - ${passed} paper checks passed`);
