# PANALO — known limitations

What this app **cannot** do, what it does **imperfectly**, and what would be
**hard or impossible** to change without altering its architecture.

Written after an audit of every source file, the SQL schema, and the live
deployment. It is deliberately blunt. `ROADMAP.md` tracks what is *planned*;
this tracks what is *true*.

Severity: 🔴 will bite you · 🟡 worth knowing · ⚪ accepted by design

---

## 1. Impossible without changing the architecture

### 🔴 Group calls cannot work
Calls are peer-to-peer WebRTC. Every extra participant needs a connection to
every other one, which collapses past about three people. Group calling needs
an **SFU** — a media server that receives one stream and fans it out. That is
separate server infrastructure with its own hosting cost, not a feature that
can be added to this codebase. The UI correctly hides call buttons in groups.

### 🔴 Calls fail on many mobile networks
`src/calls.js` configures **STUN only** — three public STUN servers, no TURN.
STUN discovers your public address; it cannot relay. On symmetric NAT (common
on mobile carriers and corporate Wi-Fi) the peers never find a path and the
call fails. TURN is a paid, always-on relay with no free production-grade
option. The About screen is honest about this, but it means **calls are
unreliable by design** until TURN is paid for.

### 🔴 The server can never search your messages
`content` is ciphertext, so Postgres full-text search has nothing to index.
Search must decrypt on the device, capping it at what one browser can hold.
This is the direct cost of encryption and is not fixable while encryption
stays.

### 🟡 Not zero-knowledge end-to-end encryption
Your private key is stored encrypted with a password-derived key **on the
server**, so history survives to a new device. Anyone who obtained both that
blob and your password could read your messages. Real E2E means losing your
history when you lose your device. This was chosen deliberately and the app
says so in About — but **do not describe Panalo as end-to-end encrypted.**

### 🟡 The app is served by the host
Even with perfect cryptography, the JavaScript doing the encrypting arrives
from Cloudflare Pages on every visit. A compromised host could serve modified
code. No browser-delivered web app escapes this — it is why messengers making
absolute guarantees ship native apps.

### ⚪ Avatars cannot be encrypted
An avatar is shown to people who share no conversation key with you — that is
what it is for. No key exists that could protect it and still let the right
people see it. Profile photos are public to anyone with the URL.

### ⚪ Metadata is visible to the server
Who talks to whom, when, how often, group membership, message sizes, read
receipts and reaction emoji are all plaintext. Encryption hides *what* you
said, not *that* you said it. Hiding metadata requires a different design.

---

## 2. Per-device state that does not sync 🟡

**Eighteen** categories of state live only in `localStorage`. None follows you
to another device, and all of it is lost when browser data is cleared — with
no warning and no export:

| State | Key |
|---|---|
| Nicknames | `panalo.nicknames` |
| Pinned chats | `panalo.pins` |
| Starred messages | `panalo.stars` |
| Pinned messages | `panalo.pinnedMsgs` |
| Folders | `panalo.folders` |
| Muted chats | `panalo.muted` |
| Per-chat fonts | `panalo.chatFonts` |
| Per-chat wallpapers | `panalo.chatWallpapers` |
| Unsent drafts | `panalo.drafts` |
| Snoozed messages | `panalo.snoozes` |
| App / chat / hidden PINs | `panalo.lock.*` |
| Locked + hidden chat lists | `panalo.lock.chats`, `panalo.lock.hidden` |
| All appearance settings | `panalo.settings` |
| Memories dismissals | `panalo.memoriesDismissed` |
| Tour seen | `panalo.tourSeen` |

Read positions (`panalo.lastRead`) are the **one** exception — they sync via
`conversation_reads`.

**Consequence:** clearing site data silently wipes every preference and every
PIN. A user on two devices effectively has two different apps.

---

## 3. Security limits that remain 🟡

- **PINs are not encryption.** App lock, chat lock and hidden chats guard
  *this device* only. The hash sits in `localStorage`; anyone with developer
  tools can clear it. They stop someone picking up your unlocked phone,
  nothing more — the app says this.
- **Hidden chats are hidden, not secret.** The chat still exists server-side
  and its messages still arrive. The gesture only hides it from the list.
- **Reaction emoji are unencrypted**, deliberately, so counts can be grouped
  without unwrapping a key per message. A 👍 leaks little, but it is plaintext.
- **Attachment URLs are unguessable, not private.** The bucket is public: the
  bytes are ciphertext now, but anyone holding a URL can fetch that ciphertext.
- **Two `SECURITY DEFINER` functions stay callable by signed-in users**, and
  cannot be otherwise. `find_profile_by_username` is how you start a chat
  with someone you don't already share one with — as `SECURITY INVOKER` it
  would be subject to the profiles policy and return nothing for exactly the
  strangers it exists to find. `delete_my_account` needs privileges the
  browser must never hold, takes no arguments, and can only delete the
  caller. The RLS helpers were moved to a non-exposed schema in phase 13, so
  these two are the only ones left.
- **Leaked-password protection is unavailable** on the Supabase free plan.
- **Deleting a chat is "delete for me."** Your copy goes; the other person
  keeps theirs. There is no delete-for-everyone, and none could be enforced.
- **Disappearing messages cannot stop a copy.** Anyone in the chat can
  screenshot, copy or save a message before its timer runs out; the app says
  so where the timer is set. After it runs out the message is hidden from
  everyone at once and deleted within fifteen minutes by a `pg_cron` job.
  **Its photos and files are not deleted**: Storage objects can only be
  removed through the Storage API, not by a database job, so the encrypted
  blob stays in the bucket under its random name. Nobody who was not already
  in the chat has its address, but it still counts against the 1 GB limit.
- **Getting a chat key back is a person's choice, not automatic.** After a
  password reset on a device that did not hold the old key, chats encrypted
  to the old key cannot be read until someone else in them presses "Share
  key". That request is the one plaintext message an encrypted chat carries;
  it contains no typed text, but the server can see that it was sent. Sharing
  wraps the chat key to the public key the server returns for that person,
  so it trusts the server exactly as much as adding a member does.
- **No admin or moderation tooling.** No way to suspend an abusive account, no
  reporting, no audit log. With real users this becomes urgent quickly.

---

## 4. Scale limits 🔴

- **Search covers what this device has seen.** The index persists in
  IndexedDB and catches up on each session, but a new device starts from the
  newest 10,000 messages, and messages you could not decrypt when they were
  indexed stay unsearchable.
- **Free tier ceilings:** 500 MB database, **1 GB file storage**, 5 GB egress,
  50,000 monthly users, and projects **pause after one week of inactivity**.
  Storage is the first wall — roughly 20 large attachments.
- **The sidebar scans the newest 500 messages globally.** Chats missed by that
  window each cost their own follow-up query.
- **Conversation keys are RSA-unwrapped once per conversation per session.**
  Fine at tens of chats; noticeable at hundreds.
- **No pagination on participants, reactions or read receipts.** A group with
  thousands of members would load all of them.
- **Realtime is capped at 200 concurrent connections** on the free plan.

---

## 5. Partial or fragile features 🟡

- **Delivery states are partly inferred.** "Seen" in a 1:1 chat falls back to
  "they replied after this message", because the other device may never write
  a marker. There is no true *delivered* state — only sent and read.
- **Typing indicators are broadcast-only** — lost if the socket drops, with no
  recovery.
- **Presence is best-effort.** "Online" reflects a live socket, so a closed
  laptop can look online briefly.
- **`sw.js` caches only the app shell.** Modules are cached opportunistically
  after first load, so a **cold first visit offline shows nothing.**
- **No offline send queue.** A message composed offline fails and offers
  Retry; navigating away loses it. Drafts are saved; unsent messages are not.
- **Message editing does not update the search index** (only send, receive and
  delete do), so search can match pre-edit text until the index is rebuilt.
- **Memories ("On this day") issues a query per horizon** on every chat open.
- **Location sharing uses OpenStreetMap's public tiles**, whose policy
  **forbids production traffic.** Works today; needs a paid provider before any
  real volume.
- **Stickers are a fixed local set** — no custom or user-uploaded stickers.
- **No spell-check of our own**, deliberately delegated to the browser.

---

## 6. Platform and dependency risks 🟡

- **No build step.** Excellent for simplicity; means no bundling, no
  minification, no tree-shaking, no dependency pinning, and one HTTP request
  per module.
- **Supabase JS loads from a CDN** with no integrity hash. If that CDN is
  unavailable or compromised, so is the app.
- **Total lock-in to Supabase** — 15 files, 54 call sites, 6 realtime channels,
  34 RLS policies. Moving backends is a rewrite of the entire data layer.
- **Hard browser requirements:** Web Crypto (HTTPS only), IndexedDB, ES
  modules. No path for older browsers — encryption switches off, which the app
  at least reports.
- **No error reporting.** Failures surface as toasts and `console.error`. With
  real users you are blind to anything nobody reports by hand.
- **No analytics** — deliberate, but it means no idea what is actually used.

---

## 7. Testing and operational gaps 🟡

- **265 tests.** 207 are pure-function (`crypto`, `textassist`, `password`,
  `mentions`, `mapLimited`, the attachment format, file kinds, the send and
  key-status rules, disappearing-message timers). 58 replay every migration
  into an in-process Postgres (`tests/migrations.test.mjs`) and exercise RLS
  and triggers as signed-in users. **Nothing covers the UI, realtime, or a
  multi-user flow in a browser**, and the test database is PGlite with a
  minimal Supabase stub, not Supabase itself.
- **Verification is manual.** This session's confidence came from driving a
  live account by hand. None of that is repeatable.
- **No CI.** Nothing runs the tests on push.
- **Migrations are hand-run.** Thirteen SQL files pasted into a dashboard, with
  no migration table and no record of what has been applied. This caused the
  worst bug of the first audit (phase 7 committed, never run) and, later,
  phase 13 moving a helper that two trigger bodies still called by name,
  which stopped anyone adding a second person to a chat until phase 14. The
  replay test now catches that class of mistake; nothing records what
  production has actually run.
- **No backups.** The free plan has none. A bad migration is unrecoverable.
- **No staging environment.** Every SQL change goes straight to production.

---

## 8. Accessibility and UX gaps ⚪

- **Keyboard navigation is incomplete** — modals do not trap focus, and the
  message list is not reachable by keyboard alone.
- **Screen-reader coverage is partial.** ARIA labels exist in places; the
  message list is not a proper live region.
- **No RTL support and no localisation** — English only, hard-coded.
- **`prefers-reduced-motion` is respected in most places, not all.**
- **No font-size control**; the app ignores OS text-size preferences.

---

## Top five by real risk

1. **Storage ceiling** — 1 GB, and attachments are the most-used feature.
2. **No moderation tooling** — no blocking, reporting or suspension, before
   any growth.
3. **Calls unreliable** without TURN, on exactly the networks phones use.
4. **No CI, no integration tests, no backups** — nothing catches a regression
   before users do.
5. **Per-device state** — clearing browser data wipes every preference and PIN
   with no warning.
