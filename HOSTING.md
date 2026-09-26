# Hosting PANALO on Cloudflare Pages

PANALO is **pure static files** — no build step, no `package.json`, nothing to
compile, and every path in the app is relative. That's why it can move hosts
freely, and why "build credits" were never something it actually needed.

---

## Move to Cloudflare Pages (free)

**1. Create the project**

1. Sign in at <https://dash.cloudflare.com> (free account).
2. **Workers & Pages → Create → Pages → Connect to Git**.
3. Authorise GitHub and pick **`Karnishh777/Panalo`**.

**2. Build settings — leave them empty**

| Field | Value |
|---|---|
| Framework preset | **None** |
| Build command | **(leave blank)** |
| Build output directory | **`/`** |

That blank build command is the important one. There's nothing to build, so
Cloudflare just serves the files.

**3. Save and Deploy.** You get `https://panalo.pages.dev` (or similar) in
about a minute.

---

## ⚠️ Then do this, or logins break

The app's URL changed, so Supabase must be told about it:

1. Supabase → **Authentication → URL Configuration**
2. Set **Site URL** to your new Pages URL
3. Under **Redirect URLs**, add the new URL too

Keep the old Netlify URL listed while both are running, so neither breaks.

---

## Adding your own domain later

Cloudflare Pages → your project → **Custom domains → Set up a domain**.
If you buy the domain through Cloudflare Registrar, DNS is configured for you
and HTTPS is automatic. Remember to update the Supabase URLs again afterwards.

---

## Why not just make a second Netlify account?

Creating extra free accounts to get around usage limits breaks Netlify's Terms
of Service, and the usual result is losing both accounts — including the one
serving your live site. There's no need to risk it: this app costs nothing to
host on Cloudflare Pages or GitHub Pages, because it never needed builds.

---

## Turning on reliable calls (TURN relay)

Calls connect two devices directly when they can. On many networks (mobile
carriers, school and office Wi-Fi) they can't, and the call needs a relay.
The app already knows how to use one; it just needs a key:

1. Cloudflare dashboard → **Realtime → TURN** → create a TURN key. Copy its
   **ID** and **API token**.
2. **Workers & Pages → panalo → Settings → Variables and secrets** → add two
   **secrets** (Production, and Preview if you want it there too):
   - `TURN_KEY_ID`
   - `TURN_KEY_API_TOKEN`
3. Push any commit (or "Retry deployment") so the new secrets are picked up.

Check: while signed in, calls on mobile data should now connect. The endpoint
is `functions/api/turn.js`; it only gives credentials to a signed-in Panalo
user and never exposes the key. Cloudflare bills relayed traffic per GB
(see their Realtime pricing); calls that connect directly use no relay.

---

## Notes

- **Your Netlify site stays up.** Running out of credits stops new *builds*,
  not serving, and free credits reset each billing cycle.
- `_headers` in the repo root sets security headers and stops the service
  worker and sticker manifest from being cached stale. Cloudflare Pages and
  Netlify both read that file, so behaviour matches on either host.
- Deploys happen on every push to `main`, the same as before.
