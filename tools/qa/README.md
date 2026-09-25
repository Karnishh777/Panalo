# Browser QA

Drive the real Panalo UI in Chromium without touching the production
Supabase project.

```sh
node tools/qa/smoke.mjs                       # pass/fail checks, exit 1 on failure
QA_SHOTS=/tmp/shots node tools/qa/smoke.mjs   # also save screenshots
```

Requires Playwright with Chromium (preinstalled in the Claude Code cloud
image; elsewhere `npm i -g playwright && npx playwright install chromium`).

## How it works

- `harness.mjs` serves the repo as static files on `127.0.0.1` and opens it in
  Chromium. It intercepts the request for the supabase-js CDN script and
  answers it with `supabase-mock.js`. **Every request to a real
  `*.supabase.co` host is aborted**, so a run cannot reach production.
- `supabase-mock.js` is an in-memory stand-in for the parts of the Supabase
  client the app uses: auth, tables with approximate RLS (you only see your
  own chats), the unique constraints the client relies on, the signup
  trigger, message expiry, storage and realtime fan-out. Anything it doesn't
  implement throws loudly rather than returning something plausible.
- Seeded data is **really encrypted** with `crypto.js` — keypairs, wrapped
  chat keys, AES-GCM messages — so the real decrypt path runs.
- The mock database survives a reload in the same tab (sessionStorage), so
  reload flows — session restore, theme before first paint, app lock — work.

Seeded account: `qa@panalo.test` / `correct-horse-42` (username `alex`), with
chats with `maya`, `jordan`, `sam` and two groups. These exist only inside the
mock; they are not real credentials.

Test hooks inside the page: `window.__qa.receive(chatName, fromUser, text)`
delivers an encrypted incoming message; `window.__qa.typing(chatName)` shows
the other side typing; `window.__qa.db` is the raw data.

## Safety

`index.html` never references the mock. It is deployed with the rest of the
repo (Pages serves every file) but is inert: it refuses to run unless the
page is on `localhost`/`127.0.0.1` **and** the harness has set
`window.__PANALO_QA__`. It contains no keys or real credentials.
