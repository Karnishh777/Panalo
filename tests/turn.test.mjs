// Tests for functions/api/turn.js (the Pages Function that hands out TURN
// relay credentials). Cloudflare and Supabase are stubbed; nothing leaves
// this process.
import { onRequestPost, onRequest } from "../functions/api/turn.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith("/auth/v1/user")) {
    const good = init.headers?.authorization === "Bearer good-token";
    return new Response(good ? '{"id":"u1"}' : '{"msg":"bad jwt"}', { status: good ? 200 : 401 });
  }
  if (String(url).startsWith("https://rtc.live.cloudflare.com/")) {
    return new Response(
      JSON.stringify({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }, { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" }] }),
      { status: 201 }
    );
  }
  throw new Error(`unexpected fetch ${url}`);
};

const req = (token) => new Request("https://x/api/turn", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
const env = { TURN_KEY_ID: "kid", TURN_KEY_API_TOKEN: "secret" };

async function main() {
  let r = await onRequestPost({ request: req("good-token"), env: {} });
  ok("not configured → 501", r.status === 501);
  ok("not configured → no outbound calls", calls.length === 0);

  r = await onRequestPost({ request: req(null), env });
  ok("no token → 401", r.status === 401);
  ok("no token → Cloudflare never asked", !calls.some((c) => c.url.includes("rtc.live")));

  r = await onRequestPost({ request: req("forged"), env });
  ok("bad token → 401", r.status === 401);
  ok("bad token → Cloudflare never asked", !calls.some((c) => c.url.includes("rtc.live")));

  r = await onRequestPost({ request: req("good-token"), env });
  const body = await r.json();
  ok("signed in → 200", r.status === 200);
  ok("returns TURN servers", body.iceServers?.some((s) => [].concat(s.urls).some((u) => u.startsWith("turn:"))));
  ok("never cached", r.headers.get("cache-control") === "no-store");
  const cf = calls.find((c) => c.url.includes("rtc.live"));
  ok("uses the key id in the URL", cf?.url.includes("/keys/kid/"));
  ok("sends the key token only to Cloudflare", cf?.init.headers.authorization === "Bearer secret");
  ok("the key token never goes to Supabase", !calls.some((c) => c.url.includes("supabase") && JSON.stringify(c.init).includes("secret")));
  ok("the key token is not in the response", !JSON.stringify(body).includes("secret"));

  r = await onRequest();
  ok("GET → 405", r.status === 405);

  globalThis.fetch = realFetch;
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.log("  FAIL:", f));
    process.exitCode = 1;
  }
}
main();
