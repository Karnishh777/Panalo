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
| 14 | [`supabase-phase16.sql`](supabase-phase16.sql) | Panalo Students: study data, private archive bucket, blocking and reports, rooms with join codes | Only if you don't use `students/` |
| 15 | [`supabase-phase17.sql`](supabase-phase17.sql) | Students hardening: archive files readable only while listed, a storage quota that can't be sidestepped, hosts can take shared files down, join codes rate-limited, door requests no longer broadcast, hosts-only posting limited to groups | Required with phase 16 |
| 16 | [`supabase-phase18.sql`](supabase-phase18.sql) | Deleting an account deletes everything: conversations only you were in, sign-in records, and (through the app) every file you uploaded; archive files may live on Cloudflare R2 (see [HOSTING.md](HOSTING.md)) | No |
| 17 | [`supabase-phase19.sql`](supabase-phase19.sql) | Launch tuning: policies work out who you are once per query instead of once per row, and every foreign key gets an index (faster deletes). No behaviour change | No |
| 18 | [`supabase-phase20.sql`](supabase-phase20.sql) | Moderation: a moderator role, the moderation page's functions (reports, notes, removing messages, suspending accounts), a passphrase to reclaim the role, and a record of every action | No |
| 19 | [`supabase-phase21.sql`](supabase-phase21.sql) | Your Study Room settings, world lighting, Drift progress (removed in phase 29) and a running focus timer follow you across devices; a focus block is recorded once even with two devices open | No |
| 20 | [`supabase-phase22.sql`](supabase-phase22.sql) | Age and a parent's consent: date of birth once, under-13s refused, 13–17 wait for a parent's approval (enforced by the database); registration details kept 180 days after deletion, then erased | No |
| 21 | [`supabase-phase23.sql`](supabase-phase23.sql) | Security logs kept 180 days (CERT-In): a locked table the hourly GitHub Action fills from Supabase's log API, erased nightly after 180 days | No |
| 22 | [`supabase-phase24.sql`](supabase-phase24.sql) | The day as a ritual: one private entry per day (first open, intention, mood and energy, one thing learned, one good thing). Powers the dawn, closing the day and the journal | No |
| 23 | [`supabase-phase25.sql`](supabase-phase25.sql) | Log in with your username: the email comes back only with the right password (so nobody can look yours up); 10 wrong tries per username per hour, kept a day | No |
| 24 | [`supabase-phase26.sql`](supabase-phase26.sql) | An Exam kind for the calendar (countdowns on Now), and how deep a focus block went (scattered, okay, deep) | No |
| 25 | [`supabase-phase27.sql`](supabase-phase27.sql) | Friends on the globe: a city you pick by hand, shown only to people you choose from your one-to-one chats, until you turn it off, for 7 days or for 24 hours; expired places erased hourly | No (phase 28 removes it again) |
| 26 | [`supabase-phase28.sql`](supabase-phase28.sql) | Panalo Students is private: friends on the globe removed with its data, and every room join code erased. Panalo Chat's conversations are untouched | No |
| 27 | [`supabase-phase29.sql`](supabase-phase29.sql) | The study profile behind the v0.2 plan: board, year, subjects and how each is going, aim, school day, boarding or travel, sleep, tuition. Drift's saved state is erased | Required by Students v0.2 |
| 28 | [`supabase-phase30.sql`](supabase-phase30.sql) | Progress behind the plan: per topic how well it is known and when it fades (`student_topics`), each subject's pace, test results (`student_results`), and which topic a focus block was on. All private to the student | Required by Students v0.2 |
| 29 | [`supabase-phase31.sql`](supabase-phase31.sql) | Boarders' evening prep time, so the plan fits school-day study inside it | Required by Students v0.2 |
| 30 | [`supabase-phase32.sql`](supabase-phase32.sql) | The student's own changes to the plan (days off, caps, a later start, more or less of a subject, skipped and moved blocks), set by hand or by telling Pan. Private, size-capped | Required by Students v0.2 |
| 31 | [`supabase-phase33.sql`](supabase-phase33.sql) | A daily limit on asking Pan: 30 asks per student per day, counted by `pan_take()` (only a count per day is kept, for 7 days) | Required for "Tell Pan" |
| 32 | [`supabase-phase34.sql`](supabase-phase34.sql) | The rest of the week: sport, art, music and coaching at set times, so the plan keeps them free | Required by Students v0.2 |
| 33 | [`supabase-phase35.sql`](supabase-phase35.sql) | Other subjects: a subject the app doesn't list, with the syllabus Pan found for it (`custom_syllabi`) | Required by Students v0.2 |
| 34 | [`supabase-phase36.sql`](supabase-phase36.sql) | Boarders' study times and weekends (`prep_slots`, `weekend_plan`, `home_travel_minutes`); your journey: a sealed download, starting again, and bringing a download back (`journey_export`, `journey_reset`, `journey_import`) | Required by Students v0.2 |
| 35 | [`supabase-phase37.sql`](supabase-phase37.sql) | Only studying grows the world: exam-style questions marked are kept as `activity_log` kind `questions` with `marks` and `out_of` | Required by Students v0.2 |

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

### Panalo Students

`students/` is a second app on the same project (see [`STUDENTS.md`](STUDENTS.md)).
It needs phases 16 and 17, and one more dashboard setting: add your site's
`/students/` URL (e.g. `https://your-site.pages.dev/students/`) under
**Authentication → URL Configuration → Redirect URLs**, so sign-up
confirmation and password-reset links can land there.

**Pan, the AI (optional).** Two things use it, with the same key and the
same 30 asks a day: "Other subject" (in the setup) asks
[`functions/api/pan-subject.js`](functions/api/pan-subject.js) for the
syllabus of a subject the app doesn't list, and "Tell Pan what to change"
on the Plan page goes through [`functions/api/pan.js`](functions/api/pan.js), which asks
Claude (the small Haiku model) to turn the sentence into changes the
student confirms before they apply. Add your Anthropic API key in
Cloudflare: **Pages → your project → Settings → Variables and secrets →
Add**, type **Secret**, name `ANTHROPIC_API_KEY`, then redeploy. Never put
the key in the code or a chat. Without it, the app understands simple
sentences ("Sundays off", "only an hour on Saturday", "more maths",
"start after 5", "skip tomorrow") on its own, and everything can be set
by hand anyway. Each request is a few hundred tokens; only signed-in
students can call it, 30 times a day each (phase 33; if that limit can't
be checked, Pan doesn't run), and their message is capped at 500
characters.

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

