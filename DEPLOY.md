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

## Security notes
- The **anon / publishable key** in `app.js` is *meant* to be public — it's safe on
  GitHub because Row-Level Security controls all access. ✅
- **Never** commit the **`service_role`** key, your **DB password**, or **SMTP
  password**. They don't belong in the frontend at all.
- `DEV_CREDENTIALS.md` is git-ignored (it holds a password). Keep it that way.
