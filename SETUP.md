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
  Browser (index.html + app.js)              Supabase (your always-on backend)
  ┌───────────────────────────┐   HTTPS      ┌──────────────────────────────────┐
  │  frontend, ships the       │  ───────►    │  Auth  (users, hashed passwords) │
  │  PUBLIC "anon" key only    │  ◄───────    │  Postgres + RLS (your data)      │
  │                            │  WebSocket   │  Realtime  (live updates)        │
  └───────────────────────────┘  ◄───────►    │  Storage  (images)               │
                                              └──────────────────────────────────┘
```

The public **anon key** in `app.js` is *meant* to be public. It's safe **because**
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

Paste both to me and I'll wire them into `app.js`, **or** edit the top of
[`app.js`](app.js) yourself:
```js
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_KEY = "YOUR-ANON-KEY";
```
> ⚠️ Never put the **`service_role`** key in the frontend — it bypasses all security.

### 3. Create the schema + security
**SQL Editor → New query** → paste all of [`supabase-setup.sql`](supabase-setup.sql)
→ **Run**. You should see "Success". This creates the tables, RLS policies,
realtime, and the storage bucket.

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

> ⚠️ Supabase's built-in shared mailer is **rate-limited** (a few emails/hour) and
> often lands in **Spam**. Fine for testing; add your own SMTP (**Authentication →
> SMTP Settings**) before real use.

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

## Known limitation to revisit
Usernames are **not** enforced unique yet (so profile creation never fails). The
"start chat by username" lookup returns the first match. Enforcing unique
usernames with a proper check at signup is a small follow-up (Phase 1.5).
