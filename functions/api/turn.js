// POST /api/turn — short-lived TURN relay credentials for a call.
//
// A Cloudflare Pages Function (Pages runs anything under /functions; the
// rest of the site is still plain static files). It exists because a TURN
// key is a long-lived secret that must never reach the browser: this trades
// it for credentials that expire, and only for someone signed in to Panalo,
// so the relay (which is billed per GB) can't be used by strangers.
//
// Setup (Cloudflare dashboard):
//   1. Realtime → TURN → create a TURN key.
//   2. Pages project → Settings → Variables and secrets → add, as secrets:
//        TURN_KEY_ID         the key's id
//        TURN_KEY_API_TOKEN  the key's API token
//   3. Redeploy (or push any commit).
// Without them this answers 501 and calls use STUN only, as before.
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

export async function onRequestPost({ request, env }) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: "turn-not-configured" }, 501);

  // Only a signed-in Panalo user: ask Supabase who this token belongs to.
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer \S+$/.test(auth)) return json({ error: "unauthorized" }, 401);
  const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY, authorization: auth },
  });
  if (!who.ok) return json({ error: "unauthorized" }, 401);

  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    }
  );
  if (!res.ok) return json({ error: "turn-unavailable" }, 502);
  const data = await res.json();
  return json({ iceServers: data.iceServers || [] });
}

export function onRequest() {
  return json({ error: "method-not-allowed" }, 405);
}
