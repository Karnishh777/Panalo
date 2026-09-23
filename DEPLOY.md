# PANALO — Deployment

PANALO is a **fully static site** (HTML/CSS/JS + Supabase). No build step, no
server to run. Any static host works, all the ones below are **free** and serve
**HTTPS** (which you need — Supabase realtime + `crypto.randomUUID()` require a
secure context, so `file://` and plain `http` won't cut it for production).

## Which one?

| Option | Best for | GitHub needed? | Speed to live |
|---|---|---|---|
| **Netlify Drop** | Just testing it *now* | No | ~30 seconds |
| **GitHub + Netlify** | Ongoing work, auto-deploy on push | Yes | ~5 min setup, then instant |
| **GitHub Pages** | Simple, all-in-GitHub | Yes | ~5 min |
| Vercel / Cloudflare Pages | Same idea as Netlify | Optional | ~5 min |

**Recommendation:** use **Netlify Drop** today to confirm the app works end-to-end,
then wire up **GitHub + Netlify** for a proper workflow once you're happy.

---

## Option A — Netlify Drop (fastest, no Git)
1. Go to <https://app.netlify.com/drop>.
2. Drag the **PANALO folder** onto the page.
3. It gives you a live URL like `https://random-name.netlify.app`. Done.
4. Do the **Supabase step** below.

## Option B — GitHub + Netlify (auto-deploy)
1. Create a repo on GitHub, push this folder to it (commands below).
2. Netlify → **Add new site → Import from Git → pick the repo**.
3. Build command: **leave empty**. Publish directory: **`.`** (the root). Deploy.
4. Every `git push` now redeploys automatically.
5. Do the **Supabase step** below.

## Option C — GitHub Pages
1. Push this folder to a GitHub repo.
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** → branch `main`,
   folder `/ (root)` → Save.
3. Your site appears at `https://<username>.github.io/<repo>/` (relative paths in
   this app work fine at a sub-path).
4. Do the **Supabase step** below.

### Pushing to GitHub (for B or C)
```bash
git init
git add .
git commit -m "PANALO initial deploy"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
`.gitignore` already excludes `DEV_CREDENTIALS.md` and `.DS_Store`.

---

## ⚠️ Required after deploying (Supabase)
Whichever host you pick, add your live URL to Supabase or email confirmation and
redirects will break:

**Authentication → URL Configuration**
- **Site URL:** your deployed URL (e.g. `https://your-site.netlify.app`)
- **Redirect URLs:** add the same URL (and keep `http://127.0.0.1:5500` for local dev)

## Auto-updates ("updates as we update here")
With **GitHub + Netlify**, deployment is automatic:
1. We change files locally.
2. `git add -A && git commit -m "..." && git push`
3. Netlify detects the push and **redeploys in under a minute** — your live URL
   updates itself. No manual upload, ever.

## Free domain options
- **Default (works today):** Netlify gives you a free `https://<name>.netlify.app`
  URL with HTTPS. This is a real, shareable domain — fine for all of India.
- **Nicer free subdomain:** Cloudflare Pages `*.pages.dev`, or community domains
  like `is-a.dev` / `js.org` (request via a PR to their repo).
- **Custom domain (cheap, not free):** a `.in`/`.com` is ~₹150–800/year from a
  registrar. Free real TLDs (Freenom, etc.) are no longer reliable — skip them.
  Point it at Netlify and you get free auto-SSL.

## Performance across India (make it smooth everywhere)
Two separate things affect speed — handle both:

1. **The app files (HTML/CSS/JS)** are served from a **global CDN** (Netlify, or
   Cloudflare if you use Pages), which has edge locations across India — so the app
   *loads* fast nationwide automatically. For maximum India coverage you can put
   **Cloudflare** (free) in front; it has PoPs in Mumbai, Delhi, Chennai, Bengaluru,
   Hyderabad, Kolkata.
2. **The chat backend (Supabase)** is the bigger lever. Every message round-trips to
   your Supabase project, so its **region** decides real-world latency. For India,
   the best region is **Mumbai / South Asia (`ap-south-1`)**.
   - Check yours: Supabase → **Project Settings → General → Region**.
   - Region **can't be changed after creation.** If it's far from India (US/EU) and
     feels laggy, the fix is to create a **new project in the Mumbai region**, re-run
     **every** migration in order (see the table in [SETUP.md](SETUP.md#3-create-the-schema--security)
     — there are eight, not two), and swap the URL + anon key in `src/config.js`.

## Security notes
- The **anon / publishable key** in `src/config.js` is *meant* to be public — it's safe on
  GitHub because Row-Level Security controls all access. ✅
- **Never** commit the **`service_role`** key, your **DB password**, or **SMTP
  password**. They don't belong in the frontend at all.
- `DEV_CREDENTIALS.md` is git-ignored (it holds a password). Keep it that way.
