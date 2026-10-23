// Panalo Students: the syllabus topic lists and question bank
// (students/assets/syllabus). Every file is checked for shape, and every
// question for what a student would trip over: four distinct options, an
// answer that exists, and a reason. Run with `node tests/syllabus.test.mjs`.
import fs from "node:fs";
import path from "node:path";
import { subjectsFor } from "../students/js/model/subjects.js";

const ROOT = new URL("../students/assets/syllabus/", import.meta.url).pathname;
let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));

const LEVELS = { igcse: "igcse1", alevel: "as" };
let files = 0;
let questions = 0;
for (const [dir, stage] of Object.entries(LEVELS)) {
  const offered = new Map(subjectsFor(stage).map((s) => [s.id, s]));
  for (const file of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".json"))) {
    files++;
    const where = `${dir}/${file}`;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(ROOT, dir, file), "utf8"));
    } catch (e) {
      ok(`${where} is valid JSON`, false, e.message);
      continue;
    }
    const subject = offered.get(doc.subject);
    ok(`${where}: names a subject offered at that level`, !!subject && file === `${doc.subject}.json`, doc.subject);
    ok(`${where}: its syllabus code matches the setup's`, !subject?.code || subject.code === doc.code, `${doc.code} vs ${subject?.code}`);
    ok(`${where}: has topics`, Array.isArray(doc.topics) && doc.topics.length > 0);
    const ids = new Set();
    for (const t of doc.topics || []) {
      ok(`${where}: topic ids are unique`, !ids.has(t.id), t.id);
      ids.add(t.id);
      ok(`${where} ${t.id}: has a name`, typeof t.name === "string" && t.name.length > 2);
      if (dir === "alevel") ok(`${where} ${t.id}: says whether it is AS or A2`, t.stage === "as" || t.stage === "a2", String(t.stage));
      for (const [i, q] of (t.questions || []).entries()) {
        questions++;
        const at = `${where} ${t.id} q${i + 1}`;
        ok(`${at}: has a question`, typeof q.q === "string" && q.q.length > 8);
        ok(`${at}: four options`, Array.isArray(q.o) && q.o.length === 4, String(q.o?.length));
        ok(`${at}: the options differ`, new Set(q.o || []).size === (q.o || []).length);
        ok(`${at}: the answer is one of them`, Number.isInteger(q.a) && q.a >= 0 && q.a < (q.o || []).length);
        ok(`${at}: says why`, typeof q.why === "string" && q.why.length > 10);
      }
    }
  }
}
ok("there is a question bank", files > 0 && questions > 0);

console.log(`\n${files} files, ${questions} questions`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.slice(0, 50).forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
