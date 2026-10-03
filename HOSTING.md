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
`functions/api/turn.js` (a Pages Function — part of this Pages project, no
separate Worker) hands relay credentials to signed-in users only. Pick ONE
provider and add its values in **Workers & Pages → panalo → Settings →
Variables and secrets** as **Secrets** (Production), then **Deployments →
Retry deployment**:

| Provider | Cost | Secrets |
|---|---|---|
| ExpressTURN (or any TURN with a fixed login) | free tier 1000 GB/month | `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` |
| Metered.ca | free tier 500 MB/month, no card | `METERED_APP`, `METERED_API_KEY` |
| Cloudflare TURN | pay per GB, needs a card | `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` |

`TURN_URLS` is comma-separated, e.g.
`turn:relay1.expressturn.com:3478,turn:relay1.expressturn.com:3478?transport=tcp`.
With a fixed login, anyone signed in to Panalo can see those credentials
during a call; rotate the password in the provider's dashboard if it leaks.

Check: `curl -X POST https://<site>/api/turn` answers 501 while nothing is
configured and 401 (sign-in required) once a provider is.

---

## Turning on 10 GB of file storage (Cloudflare R2)

Supabase's free tier holds **1 GB** of files. Cloudflare R2's free tier holds
**10 GB** (plus 1 million uploads and 10 million downloads a month, and no
charge for download traffic). `functions/api/files/[[path]].js` (a Pages
Function) stores new chat attachments and archive files there once a bucket
is bound. Until then, everything keeps going to Supabase Storage, and files
already in Supabase keep working either way.

1. **R2 → Overview → Create bucket.** Name it e.g. `panalo-files`, location
   Automatic, **Standard** storage class. Leave public access **off**: files
   are served only through the Function, which checks who is asking.
   (R2 asks for a payment method once even on the free tier; you are not
   charged while under the free limits.)
2. **Workers & Pages → panalo → Settings → Bindings → Add → R2 bucket.**
   Variable name **`FILES`**, bucket `panalo-files`. Add it for both
   Production and Preview.
3. **Settings → Variables and secrets → Add**, type **Secret**:
   `FILES_SIGNING_SECRET` = a long random string (e.g. the output of
   `openssl rand -hex 32`). It signs the ten-minute links used for
   "open in new tab" and downloads.
4. Optional: `USER_QUOTA_MB` (plain text), the most each person may store on
   R2. Default 300. With 10 GB free, 300 MB covers about 33 heavy users; lower
   it if you expect more.
5. **Deployments → Retry deployment** on the latest one.

Check: `https://<site>/api/files/health` answers `{"r2":true,"signing":true}`.
Before the binding it answers `{"r2":false,…}` and the apps use Supabase.

How it is guarded:

- Every key starts with its uploader's id (`o/<user>/…`), and only that
  person may upload under it. A file shared into a circle needs its uploader
  to be a member; reading it needs membership **and** a row in the archive
  listing, checked with the reader's own token so the database's row-level
  security decides.
- Chat attachments are encrypted in the browser before upload, so R2 only
  ever holds ciphertext for them.
- Files are served with `nosniff`, a sandboxing CSP, and only inert types
  (images, audio, video, PDF, plain text) are shown inline, so an uploaded
  HTML or SVG file can't run as part of the site.
- Deleting an account deletes everything under `o/<user>/`.

---

## Email that reaches everyone (free SMTP)

Supabase's built-in email only delivers to members of your Supabase team,
and only a few an hour. Until custom SMTP is set, **password resets fail
for everyone else** ("Email address not authorized"). Brevo's free plan
sends 300 emails a day:

1. brevo.com → sign up → *Senders, Domains & Dedicated IPs* → add and
   verify the address emails will come from.
2. *SMTP & API → SMTP* → generate an SMTP key.
3. Supabase → **Authentication → Emails → SMTP Settings** → enable custom
   SMTP: host `smtp-relay.brevo.com`, port `587`, username = your Brevo
   login, password = the SMTP key, sender = the verified address, name
   `Panalo`.
4. **Authentication → Emails → Templates → Confirm signup**: use the
   6-digit code template in [SETUP.md](SETUP.md) §4 (the apps ask for the
   code, not a link).
5. **Authentication → Sign In / Providers → Email**: turn **Confirm email**
   on. New accounts then prove they own their address; someone who logs
   in before confirming is taken back to the code screen, with a button to
   send a new one.
6. **Authentication → Rate Limits**: raise "emails per hour" from 30 if you
   expect a launch-day rush.

## Bot protection (free Cloudflare Turnstile)

Stops scripts mass-creating accounts (which would burn your email quota
and reputation). Do these **in this order**, or sign-in breaks:

1. Cloudflare → **Turnstile → Add widget**: name `Panalo`, hostname
   `panalo-5dk.pages.dev` (and your own domain later), mode **Managed**.
   You get a *site key* and a *secret key*.
2. **Workers & Pages → panalo → Settings → Variables and secrets → Add**:
   `TURNSTILE_SITE_KEY` (plain text) = the site key. **Retry deployment.**
   Check `https://<site>/api/captcha` shows the key.
3. Only now: Supabase → **Authentication → Attack Protection → Enable
   Captcha protection** → provider **Cloudflare Turnstile**, paste the
   *secret* key, save.

Most people never see the check; a suspicious visitor gets a small box in
the middle of the screen. To turn it off, reverse the order: Supabase first,
then the variable.

## Backups and staying awake (GitHub Action)

`.github/workflows/keep-alive-and-backup.yml` runs from the `main` branch:

- **Daily:** one small read through the API, so the free project is never
  paused for inactivity. If the project *is* paused, the run fails and
  GitHub emails you.
- **Sundays (or by hand: Actions → Keep alive and back up → Run):** an
  encrypted dump of the database, kept for 30 days as a workflow artifact.

Backups need two repository secrets (**Settings → Secrets and variables →
Actions → New repository secret**):

- `SUPABASE_DB_URL`: Supabase → **Connect** → *Session pooler* URI, with
  your database password in it.
- `BACKUP_PASSPHRASE`: a long random passphrase. **Keep a copy outside
  GitHub.** Without it the backups can't be opened.

The repository is public, so the dump is encrypted before upload and
nothing from it is printed in the log. To restore:

```bash
gpg --decrypt panalo-YYYY-MM-DD.tar.gpg | tar -xf -        # asks for the passphrase
pg_restore --no-owner --clean --if-exists -d "$NEW_DB_URL" app.dump
pg_restore --data-only -d "$NEW_DB_URL" auth.dump          # accounts, into a fresh project
```

GitHub stops scheduled workflows in a public repository after 60 days with
no commits; any push restarts them.

## Moderation

Reports go to the moderation page, `/students/#/moderate`. Only moderators
see reports there; the account menu shows them a **Moderation** entry with
the number waiting. From a report a moderator can:

- add a note and mark it reviewing or closed;
- remove the reported message for everyone;
- suspend the account for 1, 7 or 30 days, or until lifted (they're signed
  out everywhere within the hour), and lift a suspension.

Every action is recorded in the page's history. Questions and complaints
from Safety → "Questions or complaints about your data" arrive here too,
marked *Data request* with the date they should be answered by.

**If the moderator's account is ever deleted:** sign up or log in with any
account, open `/students/#/moderate`, and enter the moderator passphrase.
Set the passphrase on the moderation page beforehand ("If this account is
ever deleted"). Only a bcrypt hash of it is stored, and guesses are limited
to 5 an hour.

---

## Notes

- **Your Netlify site stays up.** Running out of credits stops new *builds*,
  not serving, and free credits reset each billing cycle.
- `_headers` in the repo root sets security headers and stops the service
  worker and sticker manifest from being cached stale. Cloudflare Pages and
  Netlify both read that file, so behaviour matches on either host.
- Deploys happen on every push to `main`, the same as before.
