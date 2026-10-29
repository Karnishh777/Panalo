// Tests for functions/api/mark.js (Pan marks a photo of an answer).
// Supabase and the Anthropic API are stubbed; nothing leaves this process.
import { onRequestPost, onRequest, clean, readBody, MODEL } from "../functions/api/mark.js";
import { tipsFor, EXAMINER } from "../students/js/model/examiner.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

const calls = [];
let reply = null;
let left = 29;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith("/auth/v1/user")) {
    const good = init.headers?.authorization === "Bearer good-token";
    return new Response(good ? '{"id":"u1"}' : '{"msg":"bad jwt"}', { status: good ? 200 : 401 });
  }
  if (String(url).endsWith("/rest/v1/rpc/pan_take")) return new Response(JSON.stringify(left--));
  if (String(url) === "https://api.anthropic.com/v1/messages") return reply();
  throw new Error(`unexpected fetch ${url}`);
};
const answer = (obj) => () => new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }] }), { headers: { "content-type": "application/json" } });
const req = (token, body) =>
  new Request("https://x/api/mark", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const env = { ANTHROPIC_API_KEY: "sk-test" };
const good = { image: "aGVsbG8=", q: "Find the speed.", scheme: ["C1: v = s/t", "A1: 4.0 m/s"], ans: "4.0 m/s", subject: "Physics", paper: "4", tips: tipsFor(9702, "2") };

async function main() {
  let r = await onRequestPost({ request: req("good-token", good), env: {} });
  ok("no key → 501", r.status === 501);
  r = await onRequestPost({ request: req("bad", good), env });
  ok("not signed in → 401", r.status === 401);
  r = await onRequestPost({ request: req("good-token", { ...good, image: "not base64!" }), env });
  ok("bad image → 400", r.status === 400);
  r = await onRequestPost({ request: req("good-token", { ...good, scheme: [] }), env });
  ok("no scheme → 400", r.status === 400);
  r = await onRequestPost({ request: req("good-token", { ...good, image: "A".repeat(3_000_000) }), env });
  ok("huge image → 400", r.status === 400);

  calls.length = 0;
  reply = answer({ legible: true, points: [{ earned: true, note: "Equation stated" }, { earned: false, note: "Unit missing" }, { earned: true, note: "extra" }], examiner: "Good start.", next: "Units." });
  r = await onRequestPost({ request: req("good-token", good), env });
  const out = await r.json();
  ok("marks → 200", r.status === 200);
  ok("one judgement per scheme point", out.points.length === 2 && out.points[0].earned === true && out.points[1].earned === false);
  ok("comment kept", out.examiner === "Good start." && out.next === "Units.");
  const sent = JSON.parse(calls.find((c) => c.url.includes("anthropic")).init.body);
  ok("uses the marking model", sent.model === MODEL);
  ok("the photo goes as an image", sent.messages[0].content[0].type === "image" && sent.messages[0].content[0].source.data === good.image);
  ok("the scheme and tips go in the text", /1\. C1: v = s\/t/.test(sent.messages[0].content[1].text) && /examiners advise/.test(sent.messages[0].content[1].text));

  left = -1;
  r = await onRequestPost({ request: req("good-token", good), env });
  ok("over the daily limit → 429", r.status === 429);
  left = 10;

  reply = answer({ legible: false, points: [{ earned: true, note: "?" }], examiner: "Too blurred.", next: "Retake in daylight." });
  r = await onRequestPost({ request: req("good-token", good), env });
  ok("unreadable photo earns nothing", (await r.json()).points.every((p) => !p.earned));

  ok("clean pads missing points", clean({ points: [] }, 3).points.length === 3);
  ok("readBody trims tips", readBody({ ...good, tips: Array(20).fill("x") }).tips.length === 8);
  r = await onRequest({ request: new Request("https://x/api/mark") });
  ok("GET → 405", r.status === 405);

  // The examiner advice itself.
  ok("tips: paper first, then syllabus-wide", tipsFor(9709, "1")[0] !== EXAMINER[9709]["*"][0] && tipsFor(9709, "1").includes(EXAMINER[9709]["*"][0]));
  ok("tips: unknown syllabus → none", tipsFor(1234, "1").length === 0);
  ok("tips: all short strings", Object.values(EXAMINER).every((s) => Object.values(s).every((l) => Array.isArray(l) && l.every((t) => typeof t === "string" && t.length > 10 && t.length < 300))));

  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exitCode = 1;
  }
}
main();
