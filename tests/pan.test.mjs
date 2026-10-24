// Tests for functions/api/pan.js (tell Pan how to change the plan).
// Supabase and the Anthropic API are stubbed; nothing leaves this process.
import { onRequestPost, onRequest, clean } from "../functions/api/pan.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

const calls = [];
let reply = null;
let left = 29;
const asks = () => (left === "missing" ? new Response('{"code":"PGRST202"}', { status: 404 }) : new Response(JSON.stringify(left--)));
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith("/auth/v1/user")) {
    const good = init.headers?.authorization === "Bearer good-token";
    return new Response(good ? '{"id":"u1"}' : '{"msg":"bad jwt"}', { status: good ? 200 : 401 });
  }
  if (String(url).endsWith("/rest/v1/rpc/pan_take")) return asks();
  if (String(url) === "https://api.anthropic.com/v1/messages") return reply();
  throw new Error(`unexpected fetch ${url}`);
};
const answer = (obj, extra = {}) => () => new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(obj) }], ...extra }), { headers: { "content-type": "application/json" } });

const req = (token, body) =>
  new Request("https://x/api/pan", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
const env = { ANTHROPIC_API_KEY: "sk-test" };
const good = { text: "Sundays off and more maths", today: "2026-10-19", weekday: 1, subjects: [{ id: "math", name: "Mathematics" }, { id: "phy", name: "Physics" }], rules: {} };

async function main() {
  let r = await onRequestPost({ request: req("good-token", good), env: {} });
  ok("no key → 501", r.status === 501);
  ok("no key → no outbound calls", calls.length === 0);

  r = await onRequestPost({ request: req(null, good), env });
  ok("signed out → 401", r.status === 401);
  r = await onRequestPost({ request: req("bad-token", good), env });
  ok("a bad token → 401", r.status === 401);
  ok("…and the model is never called", !calls.some((c) => c.url.includes("anthropic")));

  r = await onRequestPost({ request: req("good-token", { ...good, text: "x".repeat(501) }), env });
  ok("too long → 400", r.status === 400);
  r = await onRequestPost({ request: req("good-token", "not json"), env });
  ok("not JSON → 400", r.status === 400);

  reply = answer({ summary: "Sundays are off, and there's more maths.", changes: [
    { op: "day_off", weekday: 0, date: null, minutes: null, time: null, subject: null, weight: null },
    { op: "subject_weight", weekday: null, date: null, minutes: null, time: null, subject: "math", weight: 1.5 },
    { op: "subject_weight", weekday: null, date: null, minutes: null, time: null, subject: "bio", weight: 2 },
    { op: "delete_everything", weekday: null, date: null, minutes: null, time: null, subject: null, weight: null },
  ] });
  r = await onRequestPost({ request: req("good-token", good), env });
  const out = await r.json();
  ok("a good answer → 200", r.status === 200);
  ok("its changes come back", out.changes.length === 2 && out.changes[0].op === "day_off" && out.changes[0].weekday === 0 && out.changes[1].subject === "math");
  ok("unknown subjects and ops are dropped", !out.changes.some((c) => c.subject === "bio" || c.op === "delete_everything"));
  ok("nulls are left out", !("date" in out.changes[0]));
  ok("the summary comes back", /Sundays/.test(out.summary));
  const sent = calls.find((c) => c.url.includes("anthropic"));
  const body = JSON.parse(sent.init.body);
  ok("the key goes in x-api-key", sent.init.headers["x-api-key"] === "sk-test");
  ok("uses the small model", body.model === "claude-haiku-5-5");
  ok("asks for structured output", body.output_config?.format?.type === "json_schema");
  ok("the student's words are in the message", body.messages[0].content.includes("Sundays off and more maths"));

  reply = answer({}, { stop_reason: "refusal", content: [] });
  r = await onRequestPost({ request: req("good-token", good), env });
  ok("a refusal → no changes", r.status === 200 && (await r.json()).changes.length === 0);
  reply = () => new Response("{}", { status: 429 });
  r = await onRequestPost({ request: req("good-token", good), env });
  ok("busy → 429", r.status === 429);
  reply = () => new Response("oops", { status: 500 });
  r = await onRequestPost({ request: req("good-token", good), env });
  ok("upstream error → 502, no details", r.status === 502 && !(await r.text()).includes("oops"));
  reply = () => new Response(JSON.stringify({ content: [{ type: "text", text: "not json" }] }));
  r = await onRequestPost({ request: req("good-token", good), env });
  ok("an unreadable answer → 502", r.status === 502);

  left = -1;
  reply = answer({ summary: "x", changes: [] });
  const before = calls.filter((c) => c.url.includes("anthropic")).length;
  r = await onRequestPost({ request: req("good-token", good), env });
  ok("over the daily limit → 429 pan-limit", r.status === 429 && (await r.json()).error === "pan-limit");
  ok("…and the model is not called", calls.filter((c) => c.url.includes("anthropic")).length === before);
  left = "missing";
  r = await onRequestPost({ request: req("good-token", good), env });
  ok("if the limit can't be checked, Pan doesn't run", r.status === 503 && calls.filter((c) => c.url.includes("anthropic")).length === before);
  const take = calls.find((c) => c.url.endsWith("/rest/v1/rpc/pan_take"));
  ok("the ask is taken as the student", take.init.headers.authorization === "Bearer good-token");
  left = 10;

  ok("clean caps minutes", clean({ changes: [{ op: "day_minutes", weekday: 6, minutes: 9999 }] }, []).changes[0].minutes === 600);
  ok("clean drops bad times", !("time" in clean({ changes: [{ op: "start_after", time: "25:99" }] }, []).changes[0]));
  r = await onRequest({ request: new Request("https://x/api/pan") });
  ok("GET → 405", r.status === 405);

  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exitCode = 1;
  }
}
main();
