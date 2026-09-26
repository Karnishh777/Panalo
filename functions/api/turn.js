// POST /api/turn — TURN relay credentials for a call.
//
// A Cloudflare Pages Function (Pages runs anything under /functions; the
// rest of the site is still plain static files — no separate Worker needed).
// It keeps the relay's secret on the server and hands credentials only to
// someone signed in to Panalo, so strangers can't burn the relay's quota.
//
// Configure ONE provider in Pages → Settings → Variables and secrets
// (as secrets), then redeploy. The first one found is used:
//
//   Cloudflare TURN (needs a payment method on the Cloudflare account)
//     TURN_KEY_ID, TURN_KEY_API_TOKEN
//   Metered.ca (free tier, no card; 500 MB/month)
//     METERED_APP      the app name, i.e. <name> in <name>.metered.live
//     METERED_API_KEY
//   Any TURN server with a fixed username/password (e.g. ExpressTURN)
//     TURN_URLS        comma-separated, e.g. "turn:relay1.expressturn.com:3478"
//     TURN_USERNAME, TURN_CREDENTIAL
//
// With none of them set this answers 501 and calls use STUN only.
//
// SUPABASE_URL / SUPABASE_ANON_KEY can be overridden with variables of the
// same name; the defaults are the public values already in src/config.js.
const DEFAULT_SUPABASE_URL = "https://zqtvqobonmpxffjxbjpt.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_TQ1NrHUU3HaIcFRkOWXHuQ_yC3REquy";
const TTL_SECONDS = 4 * 60 * 60;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function provider(env) {
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) return "cloudflare";
  if (env.METERED_APP && env.METERED_API_KEY) return "metered";
  if (env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL) return "static";
  return null;
}

// Only STUN/TURN addresses may come out of here, whatever is configured.
function cleanServers(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => ({ ...s, urls: [].concat(s?.urls || []).filter((u) => /^(stun|turns?):/i.test(String(u))) }))
    .filter((s) => s.urls.length);
}

async function fetchServers(kind, env) {
  if (kind === "cloudflare") {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      }
    );
    if (!res.ok) return null;
    return (await res.json()).iceServers;
  }
  if (kind === "metered") {
    if (!/^[a-z0-9-]+$/i.test(env.METERED_APP)) return null;
    const res = await fetch(
      `https://${env.METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.METERED_API_KEY)}`
    );
    if (!res.ok) return null;
    return await res.json();
  }
  if (kind === "static") {
    const urls = String(env.TURN_URLS).split(",").map((u) => u.trim()).filter(Boolean);
    return [{ urls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }];
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const kind = provider(env);
  if (!kind) return json({ error: "turn-not-configured" }, 501);

  // Only a signed-in Panalo user: ask Supabase who this token belongs to.
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer \S+$/.test(auth)) return json({ error: "unauthorized" }, 401);
  const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY, authorization: auth },
  });
  if (!who.ok) return json({ error: "unauthorized" }, 401);

  let servers = null;
  try {
    servers = cleanServers(await fetchServers(kind, env));
  } catch {
    servers = null;
  }
  if (!servers || !servers.length) return json({ error: "turn-unavailable" }, 502);
  return json({ iceServers: servers });
}

export function onRequest() {
  return json({ error: "method-not-allowed" }, 405);
}
