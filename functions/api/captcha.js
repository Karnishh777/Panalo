// The public half of Cloudflare Turnstile: the site key, so the apps can show
// the bot check. Set TURNSTILE_SITE_KEY in the Pages project's variables; the
// secret half goes into Supabase (Authentication → Attack Protection), never
// here. Without the variable, bot protection is simply off.
export function onRequestGet({ env }) {
  return new Response(JSON.stringify({ siteKey: env.TURNSTILE_SITE_KEY || null }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
