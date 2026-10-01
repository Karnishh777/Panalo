# Panalo Students

A study, communication and creative space for intensely curious students,
at `students/`. It runs on the **same Supabase project, accounts and
encryption as Panalo Chat** — a message sent in one is an ordinary encrypted
message in the other — but it is a different product with its own interface.

> A student's life is not a spreadsheet. It's a universe.

The universe here is not a skin. Each cosmic idea encodes something real,
and everything it encodes is also available in plain words.

| Idea | What it actually is | Where |
| --- | --- | --- |
| **The day orbit** | Your 24 hours as a ring, midnight at the top. Classes and events are arcs, deadlines are diamonds, focus you did is an inner ice-blue track, finished tasks are dots, the hand is now. | Now, Calendar |
| **Your world** | A planet computed from what you did. Land = focus hours (never shrinks); lights = tasks finished; aurora = making things (30 d); forests = moving and resting (30 d); glowing seas = reading (30 d); atmosphere = messages + time with people (7 d); ring = 5 of 7 days; moons = goals; clouds = time away, cleared the day you return. | World, centre of Now |
| **Constellations** | Conversations grouped by what they are for: people, crew, study circles, classes, projects, rooms, other groups. An unread conversation's star pulses. | Signals |
| **Rooms with a door** | Temporary event rooms: a join code lets you *ask* to join, a host lets you in (which is what shares the room's key), the room can be hosts-only, and it ends on schedule. | Signals |
| **Artifacts and strata** | Files catalogued with a type glyph and a label (what, type, size, who, when, who can see it, previewable or not), laid down in monthly layers. | Archive |
| **Deep space at midnight** | The quietest room: one ring, one number, one task. | Study Room |
| **Drift** | Three things a day — something true, something to make, something to play — then the door closes. | Drift |

What stays conventional on purpose: the week timetable is a grid, forms are
forms, navigation is labelled words, every chart has a list beside it.

## Journeys

```
landing ──► the crossing (sign in / sign up) ──► first time? the birth of your universe
                                                     │  (point → flash → expansion → your world forms;
                                                     │   name it, pick interests, set a weekly goal)
                                                     ▼
                                Now ◄──► Study · Signals · World · Calendar · Archive · Drift
                                         Safety & privacy · Settings     (Warp: Ctrl/⌘ K)
```

- **Landing** (`#top`): what it is, who it's for, why, what's inside (with a
  live world demo driven by the real model), safety facts, footer. `#login`
  and `#signup` open the crossing; `#join=CODE` remembers an invite through
  sign-in.
- **Crossing**: an event horizon beside an airlock form. Crossing over
  collapses the horizon into the app. Handles login, sign-up (+ email code),
  forgot password, the unlock prompt, and password recovery — with exactly
  the key handling of Panalo Chat (`src/auth.js`).
- **Birth**: ~8 s, one canvas, a few hundred particles, skippable, replaced
  by two lines of text under reduced motion. The world that forms is the
  real one (seeded from the account id).
- **Navigation**: top bar on wide screens, a five-item dock on phones (Now,
  Study, Signals, World, More). **Warp** (Ctrl/⌘ K) jumps anywhere or does
  common things ("Start a 25-minute focus", "Join a room with a code").

## Architecture

- **No build step**, like Panalo Chat: ES modules served as files.
  `students/index.html` loads the Supabase SDK and `../crypto.js` as classic
  scripts, then `students/js/main.js`. Surfaces load on first visit
  (`import()`), so opening the app costs Now and nothing else.
- **Reused from Panalo Chat** (`src/`): the Supabase client, auth storage,
  `encryption.js` (keys, wrap/unwrap, `keyForSending`), `sendpolicy.js`
  (never plaintext into an encrypted chat), `attachments.js` (encrypted
  files), `keyshare.js` (asking for / sharing a chat key), `mediabubble.js`,
  `unread.js` + `receipts.js` (read positions sync across both apps),
  `presence.js`, `password.js`, `filekind.js`, `util.js` (`el()` — every
  string is rendered with `textContent`).
- **Pure models** (`students/js/model/`), unit-tested in
  `tests/students-model.test.mjs`: `world-model.js`, `timeline.js`,
  `focus-timer.js` (timestamps, not ticks — survives reloads and sleep),
  `drift-pick.js`, `safe-type.js`.

| File | Role |
| --- | --- |
| `js/main.js` | Outside → crossing → birth → inside. |
| `js/auth.js` | Sign-in, sign-up, unlock, recovery, sign-out. |
| `js/birth.js` | First entry: plays the film, its score, voice-over and captions, then the three questions over it. |
| `js/film.js` | "Origin", the ~26 s film: the void, genesis, worldfall (your real world, a sunrise over its limb), title. |
| `js/film-grade.js` | The film's lab: procedural 3D LUTs (void, ignition, nebula, gold) crossfaded per shot, bloom, halation, anamorphic streaks, aberration, grain, vignette, 2.39:1 bars. |
| `js/birth-score.js` | The score, mixed live with Web Audio (reverb hall, drone, heartbeat, riser, braam/boom/crack/sub hit, whoosh, pads, resolve; music ducks under the voice) and the voice-over (the device's best English voice). One sound switch, remembered per device. |
| `js/fx.js` | Hand-drawn action effects: speed lines, impact frames, punches, ink-slash reveals, water and flame ribbons, petals and embers. Off in the Study Room and with reduced motion. |
| `js/globe-dock.js` | A world's controls: play/pause, direction, speed, zoom, reset, and the light panel. |
| `js/world-light.js` | Where the sun is (Day, Dusk, Night, Live with your clock, or by hand) and how bright the night side is; saved per device, shared by every globe. |
| `js/shell.js` | Router, top bar, dock, account menu, Warp. |
| `js/store.js` | In-memory study data + pub/sub; all writes. |
| `js/signals-data.js` | Conversations, unread, sending, circles, rooms, door, block, report. |
| `js/archive-data.js` | Private-bucket uploads, downloads, previews. |
| `js/world-surface.js` | The world's terrain, colour and night lights, generated once per seed in idle time and cached. |
| `js/world-gl.js` | The world in WebGL: one fragment shader ray-traces the planet, ring and moons. Continents come from the seeded textures; finer detail is made per pixel from a tiling noise sampled three ways round the sphere (fractal coasts, ridges, beaches and shallows, torn cloud edges, city lights, cratered moons). Drag to spin and tip, with momentum; speed, direction, zoom; a manual mode the film drives. |
| `js/world-render.js` | Picks WebGL when the GPU is real, otherwise the 2D canvas globe; same `setLayers()` contract either way. |
| `js/dayorbit.js` | The SVG day orbit. |
| `js/ambient.js` | Generated study sound (Web Audio, no files). |
| `js/surfaces/*.js` | Now, Study, Signals, World, Calendar, Archive, Drift, Safety, Settings. |
| `css/tokens.css` … `surfaces.css` | The design system (below). |
| `privacy.html`, `rules.html` | Plain-language privacy notes and community rules. |

## Data (phases 16 and 17 — `supabase-phase16.sql`, `supabase-phase17.sql`)

| Table | Who can read | Notes |
| --- | --- | --- |
| `student_profiles` | you | world name, interests, born_at |
| `student_tasks`, `focus_sessions`, `student_events`, `activity_log`, `student_goals` | you | capped per person; a focus session can't claim more minutes than elapsed, or point at someone else's task |
| `resources` + bucket `student-resources` (**private**) | you, or members of the conversation it's shared with — and a shared file only while it is listed | path `u/<you>/…` or `c/<conversation>/…` decides scope; size taken from Storage; 200 MB and 1,000 files per person, counted from Storage itself; room hosts can take shared files down |
| `blocks` | the blocker | blocked senders' messages are hidden from you (restrictive policy); a person who blocked you can't add you |
| `reports` | the reporter (and the operator) | status can't be set by the reporter; 20 a day |
| `conversations.kind / ends_at / posting` | as before | ended rooms hidden at once, purged a day later (pg_cron) |
| `room_codes` | hosts | 8 characters, no lookalikes |
| `room_requests` | the requester and hosts | created only by `request_to_join(code)`, 30 attempts an hour (wrong codes count); not broadcast over realtime — the door polls |

Every rule above is replayed against real Postgres in
`tests/migrations.test.mjs` (49 Students tests, phase 17 included).

## Security and privacy decisions

- **Encryption is unchanged and shared.** Students sends through
  `keyForSending()`/`SEND` exactly like Panalo Chat.
- **Letting someone into a room is a person's decision.** Admitting wraps the
  room key to the newcomer's public key — the same trust as adding a member
  by name. Codes only let people *ask*.
- **Archive files never get a type from the uploader.** A `blob:` URL runs
  with the app's origin, so `safe-type.js` maps every file to a type that
  cannot execute (an HTML file labelled `.pdf` is opened as a PDF, SVG is
  bytes). Tested.
- **Reports can carry evidence only by choice**: messages are ciphertext, so
  the reporter decides whether to include the text.
- **`_headers`** gained `blob:` in `connect-src` (reading back a blob the app
  created itself). Nothing else in the CSP changed.
- **No AI, no analytics, no third-party scripts** beyond the Supabase SDK and,
  only when a join code is shown, a QR library from the same CDN.

## Design system

- **Colour means something**: time = amber, focus = ice, signal = violet,
  world = green, archive = sand, drift = rose. Interactive = near-white.
  Glow only for "live" (unread pulse, running timer). Every text colour
  clears WCAG AA on every surface.
- **Type**: Unbounded (display, sized so its width never orphans a word),
  Instrument Serif italic (one emotional line at a time), Inter (everything
  you read). Numbers are tabular.
- **Panels, not cards**: a region is a top rule and a coloured label.
- **Motion**: durations come from tokens; the OS setting or Settings →
  Reduce motion stills the stars, the worlds and every transition. Canvas
  loops stop when hidden or off-screen and run at ~30 fps.
- **Responsive**: top bar ≥ 900 px, dock below; Signals becomes list → thread;
  the week grid becomes a list; dialogs become bottom sheets.

## Testing

```sh
node tests/students-model.test.mjs   # world, timeline, timer, drift, safe types
node tests/migrations.test.mjs       # phase 16 RLS, against real Postgres
node tools/qa/students.mjs           # the whole app in Chromium, against the mock
```

## Not done yet (see LIMITATIONS.md §9)

Moderator UI for reports · verified teacher/school roles · parental consent ·
push notifications and an offline shell for Students · end-to-end encrypted
archive · per-project storage quota · Yearbook-style letters that unlock later.
