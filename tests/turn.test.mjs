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
  if (String(url).startsWith("https://panalo.metered.live/api/v1/turn/credentials?apiKey=mkey")) {
    return new Response(JSON.stringify([
      { urls: "stun:stun.relay.metered.ca:80" },
      { urls: "turn:global.relay.metered.ca:80", username: "mu", credential: "mc" },
      { urls: "javascript:alert(1)", username: "x", credential: "y" },
    ]));
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

  // ---- Metered ----
  calls.length = 0;
  r = await onRequestPost({ request: req("good-token"), env: { METERED_APP: "panalo", METERED_API_KEY: "mkey" } });
  let mb = await r.json();
  ok("metered → 200", r.status === 200);
  ok("metered returns its TURN server", mb.iceServers.some((s) => s.urls.includes("turn:global.relay.metered.ca:80") && s.username === "mu"));
  ok("non-STUN/TURN URLs are dropped", !JSON.stringify(mb).includes("javascript:"));
  ok("metered key is not in the response", !JSON.stringify(mb).includes("mkey"));
  r = await onRequestPost({ request: req("forged"), env: { METERED_APP: "panalo", METERED_API_KEY: "mkey" } });
  ok("metered still requires sign-in", r.status === 401 && !calls.some((c) => c.url.includes("metered.live") && c.url.includes("forged")));
  r = await onRequestPost({ request: req("good-token"), env: { METERED_APP: "evil.com/x?", METERED_API_KEY: "mkey" } });
  ok("a malformed app name can't redirect the request", r.status === 502 && !calls.some((c) => c.url.includes("evil.com")));

  // ---- Fixed username/password (e.g. ExpressTURN) ----
  r = await onRequestPost({
    request: req("good-token"),
    env: { TURN_URLS: "turn:relay1.expressturn.com:3478, turn:relay1.expressturn.com:3478?transport=tcp", TURN_USERNAME: "su", TURN_CREDENTIAL: "sc" },
  });
  const sb = await r.json();
  ok("static → 200", r.status === 200);
  ok("static returns both URLs", sb.iceServers[0].urls.length === 2 && sb.iceServers[0].username === "su");
  r = await onRequestPost({ request: req("good-token"), env: { TURN_URLS: "https://not-a-relay", TURN_USERNAME: "su", TURN_CREDENTIAL: "sc" } });
  ok("static with no valid TURN URL → 502", r.status === 502);
  r = await onRequestPost({ request: req(null), env: { TURN_URLS: "turn:x:3478", TURN_USERNAME: "su", TURN_CREDENTIAL: "sc" } });
  ok("static still requires sign-in", r.status === 401);

  // Cloudflare wins when several are configured.
  r = await onRequestPost({ request: req("good-token"), env: { ...env, METERED_APP: "panalo", METERED_API_KEY: "mkey" } });
  ok("cloudflare is preferred", (await r.json()).iceServers.some((s) => [].concat(s.urls).some((u) => u.includes("cloudflare"))));

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
