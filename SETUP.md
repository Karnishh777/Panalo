# PANALO — Backend setup (your own Supabase)

## First, your question answered: do you need a server?

**Yes — and Supabase *is* that server.** You do **not** need to write or run a
separate backend to hold logins and data. Supabase is a managed cloud backend
that runs 24/7 and gives you four things PANALO uses:

| What you need | Who provides it | Notes |
|---|---|---|
| A place to store users & passwords | **Supabase Auth** | Passwords are **hashed** (bcrypt) and stored in `auth.users`. Your frontend never sees or stores them. |
| A database for chats/messages | **Supabase Postgres** | The tables in `supabase-setup.sql`. |
| Live message delivery | **Supabase Realtime** | Pushes new messages to open clients. |
| Image storage | **Supabase Storage** | The `chat-files` bucket. |

```
  Browser (index.html + src/*.js)              Supabase (your always-on backend)
  ┌───────────────────────────┐   HTTPS      ┌──────────────────────────────────┐
  │  frontend, ships the       │  ───────►    │  Auth  (users, hashed passwords) │
  │  PUBLIC "anon" key only    │  ◄───────    │  Postgres + RLS (your data)      │
  │                            │  WebSocket   │  Realtime  (live updates)        │
  └───────────────────────────┘  ◄───────►    │  Storage  (images)               │
                                              └──────────────────────────────────┘
```

The public **anon key** in `src/config.js` is *meant* to be public. It's safe **because**
Row-Level Security (the policies in `supabase-setup.sql`) decides what each logged-in
user can actually read or write. Without those policies the key would be dangerous —
which is exactly the hole we're closing here.

---

## Steps

### 1. Create the project
1. Go to <https://supabase.com> → sign in → **New project**.
2. Pick a name, a strong database password (save it), and a region near you.
3. Wait ~2 minutes for it to provision.

### 2. Get your keys
**Project Settings → API**, and copy:
- **Project URL** (e.g. `https://abcdefgh.supabase.co`)
- **anon / publishable** key (the public one — *not* the `service_role` key)

Paste both to me and I'll wire them in, **or** edit the top of
[`src/config.js`](src/config.js) yourself:
```js
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_KEY = "YOUR-ANON-KEY";
```
> ⚠️ Never put the **`service_role`** key in the frontend — it bypasses all security.

### 3. Create the schema + security

The schema is built up in numbered files. **Run them in order, top to bottom.**
Each is idempotent, so re-running one costs nothing — but skipping one leaves
the app running against a database that is missing something it assumes is
there, which is exactly how this project once shipped a bug that made people's
encrypted history unrecoverable.

For each: **SQL Editor → New query** → paste the whole file → **Run**.

| # | File | What it adds | Skippable? |
|---|------|--------------|-----------|
| 1 | [`supabase-setup.sql`](supabase-setup.sql) | Tables, RLS, realtime, storage bucket | No |
| 2 | [`supabase-keys.sql`](supabase-keys.sql) | Encryption key storage, message `iv` | No |
| 3 | [`supabase-phase5.sql`](supabase-phase5.sql) | Profiles (bio/avatar), group management, message editing | No |
| 4 | [`supabase-phase6.sql`](supabase-phase6.sql) | Reactions, read receipts, replies | No |
| 5 | [`supabase-phase7.sql`](supabase-phase7.sql) | Username uniqueness, call invites, storage limits | Superseded by 6 |
| 6 | [`supabase-phase8.sql`](supabase-phase8.sql) | Re-applies phase 7, message-identity lock, bucket lockdown | No |
| 7 | [`supabase-phase9.sql`](supabase-phase9.sql) | Lets people delete files they uploaded | No |
| 8 | [`supabase-phase10.sql`](supabase-phase10.sql) | Rate limiting, profile scoping, account deletion | No |
| 9 | [`supabase-phase11.sql`](supabase-phase11.sql) | Owner/admin roles in group chats | No |
| 10 | [`supabase-phase12.sql`](supabase-phase12.sql) | Revokes access to phase 10/11 trigger functions | No |
| 11 | [`supabase-phase13.sql`](supabase-phase13.sql) | Moves RLS helpers out of the exposed API schema | No |
| 12 | [`supabase-phase14.sql`](supabase-phase14.sql) | Repairs chat creation, leaving and account deletion; signup creates the profile | No |
| 13 | [`supabase-phase15.sql`](supabase-phase15.sql) | Disappearing messages (24 hours / 7 days / 90 days per chat) | No |

Phase 8 is self-contained and re-applies everything phase 7 does, so running 8
is enough if you are starting fresh. Run 7 anyway if you prefer the history to
match the files.

Or run [`supabase-all.sql`](supabase-all.sql), which is every file above in
order. It is generated, never edited: after changing any phase file run
`node tools/build-supabase-all.mjs`. Every file is replayed against a real
Postgres by `node tests/migrations.test.mjs` (install once with
`cd tools/sqltest && npm install`), including re-running each one on a
database that already has everything.

Most of these end with a `select` that prints what changed — if the output does
not match what the file says to expect, stop and fix it before moving on rather
than continuing onto the next one.

### Before you rely on it

[`LIMITATIONS.md`](LIMITATIONS.md) lists what the app cannot do, what it does
imperfectly, and what would need a different architecture to change — group
calls, call reliability without TURN, the search cap, per-device state, and
the free-tier ceilings. Worth reading once before building on this.

### 4. Choose how signup verification works

**Chosen: 6-digit email OTP** (matches the app's OTP screen). Set it up:

1. **Authentication → Providers → Email** → ensure **"Confirm email" is ON**.
2. **Authentication → Emails → Templates** (older UI: **Authentication → Email
   Templates**) → select **"Confirm signup"**.
3. Replace the body with this — `{{ .Token }}` renders the 6-digit code:
   ```html
   <h2>Confirm your PANALO signup</h2>
   <p>Your verification code is:</p>
   <p style="font-size:28px; font-weight:bold; letter-spacing:6px;">{{ .Token }}</p>
   <p>Enter this 6-digit code in the app to finish creating your account.</p>
   ```
4. **Save.**

The app already calls `verifyOtp({ type: 'signup' })`, so no code change is needed.

**SMTP is required** to edit that template and reliably deliver codes. Using **Brevo**
(free, 300/day):
1. brevo.com → verify a sender under *Senders, Domains & Dedicated IPs*.
2. *SMTP & API → SMTP* → generate an SMTP key.
3. Supabase → *Project Settings → Authentication → SMTP Settings* → Enable custom SMTP:
   - Host `smtp-relay.brevo.com`, Port `587`
   - Username = Brevo login email, Password = SMTP key
   - Sender email = the **verified** sender, Sender name `PANALO`

> ⚠️ New senders often land in **Spam** the first few times. Brevo free tier is
> 300 emails/day.

*(Alternative for quick local testing: turn "Confirm email" **off** and signups log
in instantly with no code.)*

### 5. Create your debug login
See [`DEV_CREDENTIALS.md`](DEV_CREDENTIALS.md). Fastest path: Authentication →
**Users → Add user**, tick **Auto Confirm User**, and use the email/password there.

### 6. Run the app
Open the folder in VS Code → **Live Server** → open `index.html` (served at
`http://127.0.0.1:5500`). Log in with your debug account and test.

---

## Verify security is on (worth doing once)
In **Database → Policies**, every table (`profiles`, `conversations`,
`conversation_participants`, `messages`) should show **RLS enabled** with the
named policies from the SQL. If any table says "RLS disabled", re-run the SQL.

