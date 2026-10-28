// Panalo Students: other subjects (model/custom.js) and Pan's syllabus
// lookup (functions/api/pan-subject.js; Supabase and the Anthropic API are
// stubbed, nothing leaves this process). Run with `node tests/custom.test.mjs`.
import * as C from "../students/js/model/custom.js";
import { DEFAULTS, toRow, fromRow } from "../students/js/model/profile.js";
import * as P from "../students/js/model/plan.js";
import { onRequestPost, cleanSubject } from "../functions/api/pan-subject.js";

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));

// ---- the model ----
{
  ok("an id from the name", C.customId("Further Mathematics") === "xfurtherma");
  ok("…unique", C.customId("Further Mathematics", ["xfurtherma"]) === "xfurtherma2");
  ok("ids fit the database's subject pattern", /^[a-z0-9]{1,12}$/.test(C.customId("Further Mathematics", ["xfurtherma", "xfurtherma2"])));
  const s = C.cleanSyllabus({ name: "Further Mathematics", code: "9231", known: true, topics: [{ name: "Roots of polynomial equations", stage: "as" }, " Roots of polynomial equations ", { name: "" }, ...Array.from({ length: 60 }, (_, i) => `Topic ${i}`)] });
  ok("topics are cleaned, de-duplicated and capped", s.topics.length === C.MAX_TOPICS && s.topics[0].id === "c1" && s.topics[0].stage === "as" && s.topics[1].name === "Topic 0");
  ok("topic ids fit the database's topic pattern", s.topics.every((t) => /^[A-Za-z0-9.*]{1,12}$/.test(t.id)));
  const edited = C.cleanSyllabus({ name: "F", topics: [{ id: "c1", name: "A" }, { id: "c3", name: "C" }, { name: "New" }] });
  ok("edited topics keep their ids; new ones get free ids", edited.topics.map((t) => t.id).join() === "c1,c3,c2");
  ok("a syllabus with no topics is nothing", C.cleanSyllabus({ name: "X", topics: [] }) === null);
  const answers = { ...DEFAULTS, board: "cambridge", stage: "as", subjects: [{ id: "math", level: 2 }, { id: "xfurtherma", custom: true, name: " Further   Mathematics ", code: "9231", level: 3 }, { id: "nope", level: 2 }], customSyllabi: { xfurtherma: s, xgone: s } };
  const row = toRow(answers);
  ok("toRow keeps an other subject, cleaned", row.subjects.length === 2 && row.subjects[1].name === "Further Mathematics" && row.subjects[1].custom && row.subjects[1].level === 3, JSON.stringify(row.subjects));
  ok("…and its syllabus, and only chosen subjects' syllabi", Object.keys(row.custom_syllabi).join() === "xfurtherma");
  ok("at most six other subjects", toRow({ ...answers, subjects: Array.from({ length: 9 }, (_, i) => ({ id: `xs${i}`, custom: true, name: `S${i}` })) }).subjects.length === C.MAX_CUSTOM);
  ok("fromRow reads them back", fromRow(row).customSyllabi.xfurtherma.code === "9231");
  const bank = C.asBank("xfurtherma", row.custom_syllabi.xfurtherma);
  ok("a stored syllabus reads as a bank the planner can use", P.topicsInScope(bank, "as").length > 0 && P.topicsInScope(bank, "as").every((t) => t.stage !== "a2"));
  const plan = P.buildPlan({ profile: fromRow(row), syllabi: { xfurtherma: bank }, now: new Date(2026, 9, 19, 16).getTime(), days: 3 });
  ok("the plan works topic by topic for it", plan.flatMap((d) => d.blocks).some((b) => b.subject === "xfurtherma" && /^c\d+$/.test(b.topic)));
}

// ---- Pan's lookup ----
const calls = [];
let reply = null;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith("/auth/v1/user")) return new Response('{"id":"u1"}', { status: init.headers?.authorization === "Bearer good" ? 200 : 401 });
  if (String(url).endsWith("/rest/v1/rpc/pan_take")) return new Response("12");
  if (String(url) === "https://api.anthropic.com/v1/messages") return reply();
  throw new Error(`unexpected fetch ${url}`);
};
const answer = (obj) => () => new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }] }), { headers: { "content-type": "application/json" } });
const req = (token, body) => new Request("https://x/api/pan-subject", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const env = { ANTHROPIC_API_KEY: "sk-test" };

async function main() {
  let r = await onRequestPost({ request: req("good", { name: "Further Mathematics" }), env: {} });
  ok("no key → 501", r.status === 501 && calls.length === 0);
  r = await onRequestPost({ request: req(null, { name: "Further Mathematics" }), env });
  ok("signed out → 401", r.status === 401);
  r = await onRequestPost({ request: req("good", { name: "  " }), env });
  ok("no name → 400", r.status === 400);
  reply = answer({ known: true, name: "Further Mathematics", code: "9231", board: "Cambridge International AS & A Level", note: "Found it.", topics: [{ name: "Roots of polynomial equations", stage: "as" }, { name: "Hyperbolic functions", stage: "a2" }] });
  r = await onRequestPost({ request: req("good", { name: "Further Maths", code: "9231", board: "cambridge", year: "AS" }), env });
  const out = await r.json();
  ok("Pan's answer comes back cleaned", r.status === 200 && out.known && out.code === "9231" && out.topics.length === 2, JSON.stringify(out));
  const sent = JSON.parse(calls.find((c) => c.url.includes("anthropic")).init.body);
  ok("the subject goes to the model as data, with its code and year", /Syllabus code: 9231/.test(sent.messages[0].content) && /Year: AS/.test(sent.messages[0].content) && sent.output_config.format.type === "json_schema");
  ok("not known without topics", cleanSubject({ known: true, topics: [] }).known === false);
}

main().then(() => {
  if (failures.length) {
    console.error(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`ok - ${passed} other-subject checks passed`);
});
