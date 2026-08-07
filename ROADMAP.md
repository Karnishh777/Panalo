# PANALO — Engineering Roadmap

> **Status:** Draft v1 · Owner: engineering · Last updated: 2026-08-06
> **Scope of this document:** the full, phased plan to take PANALO from its current
> state (a ~450-line Supabase-backed static chat app) to a production-ready
> messaging platform, *without unnecessary rewrites*. Each phase preserves working
> functionality and is independently shippable.

## How to read this

- Phases are ordered by **dependency and risk**, not by how exciting the feature is.
  Security and correctness come before features; features that share infrastructure
  are grouped.
- Every phase has: **Goal · In scope · Out of scope · Key tasks · Decisions/tradeoffs ·
  Testing · Acceptance criteria · Effort (T-shirt size).**
- Effort is relative (S / M / L / XL), not hours — this is a planning tool, not a
  commitment.
- **Decisions marked 🔷 need your input** before that phase can start. They're
  collected in [Open decisions](#open-decisions-need-your-input) up front so nothing
  is buried.

---

## Guiding principles & hard budgets

From the brief, made measurable so future work has guardrails:

| Principle | Concrete budget / target |
|---|---|
| Speed before animations | Initial JS ≤ **100 KB gzipped**; Time-to-Interactive ≤ **2.5 s** on a mid-range Android over 3G-Fast; each route/feature lazy-loaded. |
| Reliability before features | No unhandled promise rejections; every network write has explicit error handling and user-visible failure state. |
| Accessibility before aesthetics | **WCAG 2.1 AA**: contrast ≥ 4.5:1 (text), full keyboard operability, screen-reader labels, `prefers-reduced-motion` respected. |
| Maintainability before clever code | No file > ~300 lines; single-responsibility modules; no magic values (named constants); no dead code. |
| Privacy before convenience | No user text/media sent to any third party beyond Supabase without explicit consent; **no AI/LLM APIs, ever** (hard rule from brief). |
| Low-end devices | Target **2 GB RAM / slow CPU**. Virtualize long lists; compress images client-side; avoid layout thrash; no heavy frameworks. |

**Performance budgets are enforced, not aspirational** — Phase 3 wires a bundle-size
check and Lighthouse CI so regressions fail the build.

---

## Open decisions (need your input)

These are genuine forks where the answer changes the work. I've given a recommendation
for each.

1. **🔷 Build tooling.** The brief wants tree-shaking, lazy-loading, and compressed
   assets — none of which are practical with today's "load two files from a CDN"
   setup. **Recommendation: adopt Vite** (fast dev server, near-zero config, excellent
   tree-shaking, code-splitting) while **staying vanilla JS with no UI framework**.
   This honors "lightweight / low-end" better than React/Vue (which cost 40–140 KB
   before you write a line) and avoids a rewrite. *Alternative: stay build-less and
   hand-split modules — cheaper now, but you forfeit most perf goals.*

2. **🔷 Framework.** Recommendation: **no framework.** Small reactive helpers + native
   Web APIs. Revisit only if state complexity demands it. (Keeps bundle tiny; aligns
   with low-end target.)

3. **🔷 Server layer.** Supabase alone covers auth, DB, realtime, storage. Three things
   it *can't* do purely client-side: (a) validating some writes that RLS can't express,
   (b) sending real OTP emails / rate-limiting, (c) TURN relay for calls. **Recommendation:
   use Supabase Edge Functions** (Deno, serverless) for (a)/(b) and a managed TURN
   service for (c) — avoids standing up a full backend.

4. **🔷 Voice/video scope.** 1:1 calls (WebRTC mesh) are feasible on Supabase Realtime
   for signaling. **Group calls need an SFU** (heavy infra/cost). Recommendation:
   ship **1:1 first**, treat group calls as a separate later initiative.

5. **🔷 Premade image / sticker library.** "Extensive, bundled locally" conflicts with
   the bundle budget. Recommendation: ship a **curated set as optimized WebP/AVIF in
   Supabase Storage**, lazy-loaded and cached via Service Worker — not baked into the JS
   bundle. Decide how large the initial curated set should be.

6. **🔷 Grammar correction depth.** "No AI" is fully compatible with *deterministic*
   text assistance, but full grammar checking is heavy. Recommendation: ship the
   **cheap, high-value deterministic layer first** (auto-capitalization, smart
   punctuation, common-typo dictionary, `nspell`/Hunspell spellcheck lazy-loaded per
   language ~1 MB) and treat full grammar (LanguageTool-class) as optional later — noting
   LanguageTool's public API would send user text off-device, which conflicts with the
   privacy principle, so it would need self-hosting. See [Phase 8](#phase-8--deterministic-text-assistance-no-ai).

7. **🔷 Map tiles.** Leaflet + OpenStreetMap is the right call (no Google dependency),
   but the public OSM tile server prohibits production traffic. Recommendation: use a
   tile provider with a free tier (MapTiler / Stadia Maps) or self-host tiles.

---

## Current-state snapshot

Pure client-side SPA (`index.html`, `app.js`, `style.css`, `logo.svg`), no build step.
Supabase provides Auth + Postgres (`profiles`, `conversations`,
`conversation_participants`, `messages`) + Realtime + Storage (`chat-files`, public).
All logic is client-side; **all security currently depends on RLS policies not yet
reviewed.** Full findings are in the audit (see conversation); the critical ones —
stored XSS via `username`/group-name/`file_url`, client-trusted writes, a public email
directory, and a dead OTP flow — are addressed in Phases 0–1.

---

## Phase 0 — Stabilize (stop the bleeding)  ✅ DONE (2026-08-07)

**Goal:** eliminate the live security/correctness defects with contained, non-breaking,
mostly client-side changes. Nothing here needs backend access.

**Effort: S–M**

> **Shipped:** XSS killed by moving all rendering to a safe DOM builder (`el()` +
> `textContent`) plus `safeImageUrl()` allow-listing our Storage origin (unit-tested
> against injection/beacon/lookalike payloads — all rejected). OTP flow wired
> (`signUp` → `verifyOtp` `type:'signup'`). `emailRedirectTo` de-hardcoded. Direct
> chats deduped (`findExistingDirect`). Errors surfaced via accessible toasts +
> double-submit guards (`withBusy`). Keyboard-navigable conversation list +
> focus rings + reduced-motion.
>
> **Backend dependency (OTP):** for the 6-digit code to arrive, the Supabase
> **"Confirm signup" email template must include `{{ .Token }}`** (not only the
> confirmation link). One dashboard change. Until then, signup falls back to the
> link (code path still correct).
>
> **Direct-chat naming bug — FIXED (2026-08-07):** `fetchConversations` now
> resolves each direct chat's title from the *other* participant's username
> (`resolveDirectTitles`), so both parties see the correct name. `REPLICA IDENTITY
> FULL` on `messages` is now set by `supabase-setup.sql`; the realtime DELETE
> listener stays unfiltered (harmless DOM-guarded no-op) — fine to leave.

### In scope
- **Fix stored XSS.** Centralize rendering through a safe DOM-builder (create elements +
  `textContent`, or a single audited `escape()` used everywhere). Escape/validate
  `username`, group `name`/`title`, and **validate `file_url`** (only allow the app's
  Storage origin + `https:`; reject anything else) before it reaches an `<img src>`.
- **Repair the OTP flow.** Either (a) wire up the real Supabase email-OTP path
  (`signInWithOtp` / `verifyOtp`) so step 2 actually works, or (b) remove the dead
  two-step UI and keep the confirmation-link flow — **pick one** (see decision below).
- **De-hardcode `emailRedirectTo`** — derive from `window.location.origin`.
- **Dedup direct chats** — before creating a `direct` conversation, look up an existing
  one between the two participants and reuse it.
- **Scope the realtime DELETE subscription** to the current conversation.
- **Error handling + double-submit guards** on auth and send (disable buttons in-flight,
  surface failures instead of swallowing them).

### Out of scope
Pagination, virtualization, image compression (Phase 2); RLS (Phase 1).

### Decisions/tradeoffs
- 🔷 **OTP vs. confirmation link.** Real OTP is better UX and matches the existing UI,
  but requires the Supabase email OTP template enabled. Confirmation-link is already
  half-working. *Recommendation: real email OTP*, since the UI already promises it.
- Safe-DOM refactor touches render functions but is behavior-preserving.

### Testing
- Manual XSS probes: set username / group name / a crafted `file_url` to
  `"><img src=x onerror=alert(1)>` and confirm no execution.
- Unit tests for `escape()` and `isAllowedImageUrl()`.
- Regression pass: login, signup, send text, send image, delete, realtime receive.

### Acceptance criteria
- No injection executes from any user-controlled field.
- OTP flow either fully works end-to-end or is fully removed (no dead UI).
- Creating a direct chat twice with the same person yields **one** conversation.
- Every user-facing async action shows success or a clear error; no silent failures.

---

## Phase 1 — Backend security (RLS + policies)

**Goal:** make the database enforce what the client currently only pretends to enforce.
**This is the real fix for client-trusted writes.**

**Effort: M · ✅ DELIVERED as `supabase-setup.sql` (2026-08-07).**

> **Context change:** the original backend was a friend's Supabase project that is no
> longer reachable, so we're standing up a **fresh** project. That let us define
> correct security from scratch instead of retrofitting. See `SETUP.md`.
>
> **What the SQL enforces:** `profiles` has **no email column** (PII gone; usernames
> stay public for lookup); `messages`/`conversations`/participants readable only by
> members via a SECURITY-DEFINER `is_conversation_member()` (avoids RLS recursion); a
> `BEFORE INSERT` trigger stamps `user_id`/`username` server-side (**no sender
> spoofing**); only a conversation's creator can add participants (**no joining
> arbitrary rooms**); storage bucket + realtime configured. Client updated: profile
> upsert no longer sends email.
>
> **Remaining to activate:** you run the SQL, paste me the new Project URL + anon key
> (I wire `app.js`), pick the signup-verification mode, and create the debug user.
>
> **Follow-up (Phase 1.5):** enforce unique usernames with signup-time validation.

### In scope (target policy set — to be reconciled with your actual schema)
- `profiles`: a user may read **only** their own row + the minimal public fields
  (`id`, `username`, avatar) of others — **never email**. Split PII into a private view
  or column-level restriction so username lookup can't leak email.
- `conversations`: readable only by participants; `insert` allowed but membership is the
  gate for everything else.
- `conversation_participants`: a user may add themselves; adding *others* is constrained
  (e.g. only the group creator/admin, or via an Edge Function that validates the
  invite). Prevents "add myself to any conversation."
- `messages`: `insert` only where `user_id = auth.uid()` **and** the user is a
  participant; `username` should be **derived server-side / trigger-set**, not trusted
  from the client (kills sender spoofing); `delete`/`update` only by author.
- Storage `chat-files`: uploads scoped to authenticated users; consider signed URLs or a
  per-conversation path prefix instead of a fully public bucket.

### Decisions/tradeoffs
- **Trusting `username` on the message row** is the spoofing risk. Options: (a) drop the
  column and join to `profiles` at read time (always correct, slightly more query cost),
  or (b) set it via a `BEFORE INSERT` trigger from `auth.uid()`. *Recommendation: (a)*
  for correctness (renames propagate) unless read performance forces denormalization.
- Some invariants (e.g. "only group admins add members") may exceed what RLS expresses
  cleanly → small **Edge Function** with `service_role`, validated server-side.

### Testing
- Policy tests using two test users: attempt cross-user reads, self-insert into a
  foreign conversation, message spoofing, foreign delete — all must be rejected.
- Confirm the legitimate flows still pass under the new policies (no lockout).

### Acceptance criteria
- No email addresses reachable by a non-owner.
- No user can join a conversation they weren't invited to, spoof a sender, or delete
  another user's message — verified by failing tests before the fix and passing after.

---

## Phase 2 — Core UX & performance

**Goal:** make the chat itself fast and pleasant on low-end devices.

**Effort: M–L · Depends on: Phase 0.**

> **Shipped so far (2026-08-07):**
> - **Client-side image compression** (`compressImage`): downscales to ≤1600px and
>   re-encodes to WebP/JPEG (q0.8) before upload; skips GIFs + small files; falls
>   back to the original on any failure or no size gain.
> - **"Keep me logged in"** control: custom auth-storage adapter routes the session
>   to localStorage (persist) vs sessionStorage (clear on close); default = remember.
>   Fixes "asks login each time" (also: use a **consistent origin** — always Live
>   Server `http://127.0.0.1:5500`, since storage is per-origin).
>
> **Still to do in this phase:** message pagination + virtualization, optimistic
> send (with echo de-dup), lazy/progressive image loading in the viewer, and
> trimming redundant sidebar re-renders on chat open.

### In scope
- **Message pagination + windowing.** Load the most recent N (e.g. 30), fetch older on
  scroll-up ("load earlier"), and **virtualize** the list so DOM node count stays bounded
  regardless of history length.
- **Optimistic send.** Render the message immediately with a "sending" state; reconcile
  with the realtime echo; show a retry affordance on failure. De-duplicate the echo so
  the sender never sees a message twice.
- **Client-side image compression** before upload (canvas/`createImageBitmap` →
  WebP/JPEG, capped dimensions + quality), with a **size limit** and progress indicator.
  Progressive/lazy loading of received images (`loading="lazy"`, blur-up placeholder).
- **Reduce re-renders** — stop rebuilding the whole sidebar on every chat open; update
  only what changed.

### Decisions/tradeoffs
- Virtualization: hand-rolled windowing keeps the bundle tiny (preferred) vs. a library
  (faster to build, more weight).
- Compression quality vs. fidelity — expose a sensible default; the brief accepts
  "acceptable quality" for big wins in upload speed/data use.

### Testing
- Seed a conversation with 5 000 messages; confirm bounded memory, smooth scroll, correct
  ordering when paginating.
- Optimistic send under simulated latency/failure (offline toggle) — no duplicates, retry
  works.
- Compression: verify output dimensions/size and that EXIF orientation is handled.

### Acceptance criteria
- Opening a 10k-message chat stays under the memory/TTI budgets.
- Sending feels instant; failures are recoverable; no duplicate bubbles.
- A 4 MB photo uploads as a compressed derivative within the size cap.

---

## Phase 3 — Modularization, build & CI guardrails

**Goal:** turn the single 400-line file into a maintainable, tree-shaken, budgeted
codebase — *incrementally*, preserving behavior at each step.

**Effort: M · Depends on: 🔷 build-tooling decision.**

### In scope
- Introduce **Vite** (or the chosen tool). Split `app.js` into modules: `auth`,
  `conversations`, `messages`, `realtime`, `storage`, `ui/*`, `lib/dom`, `lib/supabase`.
- Extract constants (colors, limits, table names) — no magic values.
- **Bundle-size budget check** and **Lighthouse CI** (perf + a11y) in the pipeline;
  regressions fail.
- Code-splitting: heavy/optional features (maps, calls, spellcheck dictionaries) become
  lazy-loaded chunks.

### Decisions/tradeoffs
- Adds a `node_modules`/build step (small ongoing cost) in exchange for every downstream
  perf goal. Behavior is preserved; this is refactor-only.

### Testing
- The full Phase 0–2 regression suite must pass unchanged after modularization
  (behavior-preserving refactor is the whole point).

### Acceptance criteria
- No module > ~300 lines; no duplicated logic; budgets enforced in CI and currently green.

---

## Phase 4 — Real-time social features

**Goal:** the "feels alive" features, most of which map cleanly onto Supabase Realtime
(Presence + Broadcast) with little new infra.

**Effort: M–L · Depends on: Phases 1–3.**

### In scope (roughly in value order)
- **Typing indicators** & **presence/online status** (Realtime Presence — ephemeral, no
  DB writes).
- **Read receipts** (per-participant last-read marker).
- **Reactions**, **replies (quote)**, **forwarding**, **pinned messages** — each a small
  schema addition + UI, done one at a time and fully finished.
- **Search** (Postgres full-text over messages, scoped by RLS to the user's
  conversations).
- **Notifications** (Web Push via Service Worker; requires Phase 9 SW).

### Decisions/tradeoffs
- Presence/typing are ephemeral (broadcast) → cheap, no history. Read receipts need
  persistence → schema + RLS.
- Search: start with `to_tsvector` + GIN index; scope carefully so RLS isn't bypassed.

### Testing
- Multi-client tests (two+ sessions) for presence, typing, receipts, reactions.
- Search relevance + RLS scoping (can't find messages in conversations you're not in).

### Acceptance criteria
- Each feature works across ≥2 concurrent clients, respects RLS, and degrades gracefully
  offline.

---

## Phase 5 — Media & premade image system

**Goal:** the image/sticker/greeting system, done within budget.

**Effort: M · Depends on: Phase 2 (compression/lazy-load) · 🔷 library-hosting decision.**

### In scope
- **Image viewer**: preview, pinch/scroll **zoom**, **download**.
- **Premade image communication**: curated greeting/reaction cards (Good Morning, Happy
  Birthday, etc.) + **stickers/emoji** — served from Storage, lazy-loaded by category,
  cached by the Service Worker. Picker UI with categories/search. **All local/curated,
  no external generation** (honors the no-AI rule).
- Progressive image loading (blur-up) end-to-end.

### Decisions/tradeoffs
- Bundling vs. Storage-hosting the library (see decision #5). Storage + SW cache keeps the
  JS bundle within budget while still feeling "instant" after first load.

### Testing
- Zoom/download across devices; picker performance with a large catalog (virtualized);
  offline availability of cached stickers.

### Acceptance criteria
- Picker opens fast, stays within memory budget, works offline once cached; sending a
  premade image is one tap.

---

## Phase 6 — Voice & video calling (WebRTC)

**Goal:** low-latency 1:1 calls with connection recovery.

**Effort: XL · Depends on: 🔷 scope + TURN decision; Phases 1,3.**

### In scope
- **1:1 audio/video** via WebRTC. **Signaling over Supabase Realtime Broadcast** (offer/
  answer/ICE) — no separate signaling server needed.
- **STUN** (free public) + **TURN** (managed service) for NAT traversal.
- Adaptive bitrate, mute/camera toggle, **reconnection/ICE-restart** on network drop,
  call UI (ringing, in-call, ended).

### Out of scope (separate initiative)
- **Group calls** — require an SFU (mediasoup/LiveKit-class); significant infra/cost.

### Decisions/tradeoffs
- TURN is a real cost (relayed media). Mesh only scales to 1:1 / tiny groups; anything
  larger needs an SFU. Ship 1:1 first and measure.

### Testing
- Cross-network calls (behind NAT, behind symmetric NAT to force TURN); forced network
  loss → auto-recovery; permission-denied and busy states.

### Acceptance criteria
- 1:1 call connects across NATs, survives a brief network drop, and tears down cleanly.

---

## Phase 7 — Maps & location sharing

**Goal:** share location without a Google dependency.

**Effort: S–M · Depends on: 🔷 tile-provider decision; Phase 3 (lazy chunk).**

### In scope
- **Leaflet + OpenStreetMap** rendering, lazy-loaded only when used.
- Share current location (Geolocation API, with permission), render a location message,
  open in a map view. Static-map thumbnail in the bubble to avoid loading Leaflet inline.

### Decisions/tradeoffs
- Public OSM tiles are not for production traffic → use a free-tier provider or self-host
  (decision #7). Privacy: location is sensitive — explicit per-share consent, never
  automatic.

### Testing
- Permission grant/deny; accuracy display; tile provider fallback; lazy chunk doesn't load
  for users who never open a map.

### Acceptance criteria
- Location sharing is opt-in per message, renders correctly, and adds zero cost to users
  who don't use it.

---

## Phase 8 — Deterministic text assistance (no AI)

**Goal:** helpful, **fully deterministic** writing help. No ML, no LLMs, no external text
services that would leak user content.

**Effort: M · Depends on: Phase 3 (lazy dictionaries) · 🔷 depth decision.**

### In scope (tiered — ship top tier first)
- **Auto-capitalization** (sentence starts, "i" → "I").
- **Smart punctuation** (straight→curly quotes, `--`→em dash, ellipsis).
- **Common-typo dictionary** (deterministic replacements: teh→the, etc.).
- **Spell-check** via `nspell` + Hunspell dictionaries, **lazy-loaded per language**
  (~1 MB each — never in the initial bundle), with underline + suggestions.
- *(Optional, later)* full grammar via a **self-hosted LanguageTool** — flagged because
  its public API would send user text off-device (privacy conflict).

### Decisions/tradeoffs
- Everything here is rule/dictionary based → deterministic, testable, private, and works
  offline. The heavy part is dictionary size → strictly lazy-loaded and cached.

### Testing
- Golden-file tests: input → expected corrected output for each rule; dictionary
  lazy-loads only on demand; no network calls carry user text.

### Acceptance criteria
- Corrections are deterministic and unit-tested; zero user text leaves the device; initial
  bundle unaffected by dictionaries.

---

## Phase 9 — Offline, sync & PWA

**Goal:** usable on flaky/no connectivity; installable.

**Effort: L · Depends on: Phases 2–4.**

### In scope
- **Service Worker**: app-shell + asset caching (also powers sticker/tile caching and Web
  Push).
- **Offline outbox**: queue sends in IndexedDB, flush on reconnect (**Background Sync**),
  with clear pending/failed states.
- **Realtime reconnection** and gap-fill (fetch messages missed while disconnected).
- **PWA manifest** + installability.

### Testing
- Airplane-mode send → reconnect → delivery, no dupes, correct ordering; SW update flow;
  Lighthouse PWA pass.

### Acceptance criteria
- Messages composed offline send automatically on reconnect; the app loads and shows
  cached content with no network.

---

## Cross-cutting workstreams (run alongside, not after)

- **Accessibility (continuous):** labels for every input, keyboard operability for
  conversation list/modals (focus traps, Escape to close), visible focus, AA contrast
  (audit the muted greys), `prefers-reduced-motion`, screen-reader announcements for new
  messages, scalable fonts. Font-scaling + high-contrast + color-blind-safe palette are
  explicit settings.
- **Security (continuous):** input sanitization everywhere, upload validation (type +
  size + magic-byte check), rate limiting (Edge Function / Supabase), CSP header, no
  secrets beyond the intended public anon key.
- **Testing strategy:** unit (escaping, compression, rules), integration (RLS policy
  tests, realtime multi-client), E2E (Playwright: auth → chat → media → call happy paths),
  perf (Lighthouse CI + bundle budget). No feature is "done" without its tests.
- **Observability:** lightweight client error reporting and basic metrics (delivery
  latency, failed sends) — privacy-respecting, no third-party trackers.
- **i18n scaffolding:** externalize strings early so senior-citizen / multi-audience needs
  and future languages are cheap.

---

## Risk register (top risks)

| Risk | Impact | Mitigation |
|---|---|---|
| RLS is currently permissive/absent | Data exposure, spoofing, deletion | Phase 1, gated on your schema; policy tests prove it. |
| Stored XSS live in production | Account/session compromise | Phase 0 (immediate). |
| Bundle bloat from stickers/dictionaries/maps/calls | Fails low-end perf budget | Lazy-load every heavy asset; enforce budget in CI (Phase 3). |
| TURN/SFU cost & complexity | Calling stalls or overruns | 1:1 first over free STUN + managed TURN; defer group/SFU. |
| Map tile ToS / cost | Maps break in production | Paid free-tier provider or self-host (decision #7). |
| "No-AI" grammar expectations vs. effort | Scope creep | Ship deterministic tiers; treat full grammar as optional self-hosted. |

---

## Sequencing summary

```
Phase 0  Stabilize (now, no deps)
Phase 1  RLS/backend  ── blocked on schema paste
Phase 2  Core UX & perf ── after 0
Phase 3  Modularize/build ── after 2 (unlocks lazy-loading for 5–8)
Phase 4  Realtime social ── after 1–3
Phase 5  Media & premade images ── after 2 (+3 for lazy chunks)
Phase 6  Voice/video (1:1) ── after 1,3
Phase 7  Maps ── after 3
Phase 8  Text assistance ── after 3
Phase 9  Offline/PWA ── after 2–4
Cross-cutting: a11y, security, testing, i18n — continuous
```

**Immediate next actions:** (1) start Phase 0; (2) reconcile Phase 1 against your pasted
RLS + schema; (3) settle the seven open decisions above (I've recommended a default for
each, so silence = we proceed with the recommendation).
