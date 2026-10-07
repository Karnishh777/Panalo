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
| **Constellations** | Conversations grouped by what they are for: people, crew, study circles, classes, projects, rooms, other groups. With nothing open, Signals shows them as a sky (`js/surfaces/sky.js`): each conversation a star (size = members, brightness = how recent, a pulse = unread, a green rim = online), each kind a constellation whose lines join its stars by recency. Every star is a link; the list beside it says the same. Each thread's header shows its members as a small constellation. | Signals |
| **Rooms with a door** | Temporary event rooms: a join code lets you *ask* to join, a host lets you in (which is what shares the room's key), the room can be hosts-only, and it ends on schedule. | Signals |
| **Artifacts and strata** | Files catalogued with a type glyph and a label (what, type, size, who, when, who can see it, previewable or not), laid down in monthly layers. | Archive |
| **Deep space at midnight** | The quietest room: one ring, one number, one task. | Study Room |
| **The day, as a ritual** | The first open of each day plays a short dawn over your own world: which day of it this is, and what changed since you were last here. Then one intention ("the one thing for today"). In the evening, closing the day takes twenty seconds: how it felt, energy, one tap for what else you did (logged to your world), one thing learned, one good thing. A closed day lights a star. | Now, World → Journal |
| **This month, in stars** | Each day of the month has a fixed place in a constellation; a day you showed up on (focus, a finished task, a log, a closed day) lights its star, joined in order. A missed day stays dark — nothing resets, there is no streak. | World |
| **The weekly chronicle** | The first visit of a new week plays last week as a few full-screen slides: focus against the week before, the best day, where it went by subject, what you finished and logged, the days you showed up and how they felt, what you wrote down, and your world on Monday beside Sunday. A quiet week isn't played (no report card for rest). Replay from World or Warp. | after the dawn, World |
| **Moments** | Reaching a discovery (first hour, a ring, a moon completed, a hundred pages) stops the screen for a second: a flash, its name, what it means, your world behind it. Once each, never during a focus block. | anywhere |
| **Seasons** | Every 28 days from your world's birth is a season with a name (First Light, Tides, Ember…). The dawn and World say which, and how far in. | World, the dawn |
| **Watch it grow** | Your world from the day it was born to today in eight seconds, with a slider to stop at any day. | World |
| **Quick add** | Type a line on Calendar — “Physics test fri 10am”, “Maths class every mon 9-10”, “Essay due 12/10” — see what it understood, press Enter. Dates are read day-first; a bare hour under 8 is the afternoon. Details… opens the full form, filled in. | Calendar |
| **Exam countdowns** | Entries of kind Exam count down on Calendar and on Now (“12 days — Physics paper 1”). | Calendar, Now |
| **A plan for today** | In the Study Room, choose 1–4 blocks; rests between them start by themselves, and the phase reads “block 2 of 3”. After each block: how deep was it? (scattered, okay, deep — the chronicle counts deep blocks). This week by subject sits under your sessions. Space starts and pauses. | Study Room |
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
  live world demo driven by the real model), the product in four honest
  numbers, a letter, safety facts, questions answered, footer. Around it
  (`js/landing-hud.js`): a count-to-100 gate on the first visit of a session,
  a HUD with the current chapter and scroll progress, the thread (a star per
  chapter down the right edge, lit as you pass, each a link), and headings
  that decode as they arrive. All of it steps aside for reduced motion. `#login`
  and `#signup` open the crossing; `#join=CODE` remembers an invite through
  sign-in.
- **Moderation** (`#/moderate`): reports and data requests for moderators;
  a passphrase door for anyone else (HOSTING.md → Moderation).
- **Looks** (`js/looks.js`, `css/looks.css`): three complete ways the whole
  app (and the landing) looks and moves, chosen from the Look button in the
  top bar or on the landing, from Warp ("Look: …"), or in Settings, where
  it's your default. It's a preference, so it follows you to every device;
  `js/boot.js` applies it (and loads its fonts) before the first paint.
  - **Glass** (default): frosted, layered panels over your world, Instrument
    Serif headlines, light that catches the glass under your pointer; the
    photoreal world; arrivals dissolve in from a soft focus; light glints
    and soft exposure blooms instead of comic hits; dust in a sunbeam.
  - **Signal** (after Nothing): black, white, grey and one red (for what's
    live, now or waiting); Doto dot-matrix display type, Space Grotesk and
    Space Mono; rounded tiles with LED glyph strips that light as you come
    near; Nothing-style switches; the world drawn as a field of LEDs (red
    only where it glows: cities, dusk); arrivals resolve dot by dot.
  - **Verse** (the special one): your day in orbit -- on wide screens the
    Now log's panels hang either side of your world -- drawn like a modern
    comic torn between universes. Ink black, hot pink, electric cyan, paper
    white; Anton poster headlines printed out of register and twitching on
    twos; torn-tape labels; white ink frames with offset shadows that glitch
    when touched; spray paint where your pointer goes; rifts flickering in
    the dark; lettered sound effects and speed lines on actions; the world
    printed as a comic (cel bands, halftone, ink, misregistration),
    animated on twos, and now and then slipping for a moment into another
    universe's style (Signal, noir, 8-bit) with a label saying which.
  Everything that moves stands still with reduced motion; the Study Room
  stays quiet in every look.
- **Effects with a purpose**: ink, petals and button hits only on Now,
  World and Drift. Signals, Calendar, Archive, Settings, Safety and
  Moderation stay still; the Study Room is the quietest of all.
- **Settings follow you** (`js/sync.js`, phase 21): preferences, lighting,
  Drift and a running timer, newest change wins.
- **Crossing**: an event horizon beside an airlock form. Crossing over
  collapses the horizon into the app. Handles login, sign-up (+ email code),
  forgot password, the unlock prompt, and password recovery — with exactly
  the key handling of Panalo Chat (`src/auth.js`).
- **Birth**: ~8 s, one canvas, a few hundred particles, skippable, replaced
  by two lines of text under reduced motion. The world that forms is the
  real one (seeded from the account id). It's personal at both ends: your
  username is written in stars under the title (`js/starwriter.js`), and
  after the three questions the finale (`js/finale.js`) draws one
  constellation per interest you picked around your world, writes your
  world's name in stars, and falls through the clouds into the app (about
  six seconds; a click or Escape skips it; not played under reduced motion
  or if you skip the questions).
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
| `js/birth-score.js` | The score, mixed live with Web Audio (reverb hall, drone, heartbeat, riser, braam/boom/crack/sub hit, whoosh, pads, resolve; music ducks under the voice) and recorded voice-over playback. One sound switch, remembered per device. |
| `media/film.json` | Optional recorded voice lines and video plates for the film; see FILM.md. |
| `js/fx.js` | Hand-drawn action effects: speed lines, impact frames, punches, ink-slash reveals, water and flame ribbons, petals and embers. Off in the Study Room and with reduced motion. |
| `js/globe-dock.js` | A world's controls: play/pause, direction, speed, zoom, reset, and the light panel. |
| `js/world-light.js` | Where the sun is (Day, Dusk, Night, Live with your clock, or by hand) and how bright the night side is; saved per device, shared by every globe. |
| `js/shell.js` | Router, top bar, dock, account menu, Warp. |
| `js/dawn.js` | The first seconds of each day: a sunrise over your world, the day number, what changed since your last visit, then one question. Once a day across devices (daily_entries.opened_at). |
| `js/checkin.js` | The morning intention and closing the day. |
| `js/chronicle.js` | Last week as a story (once per week, after the dawn; on demand from World and Warp). |
| `js/moment.js` | A full-screen moment for each new discovery, once each (seen ones follow your preferences across devices). |
| `js/timelapse.js` | Watch it grow: the world from birth to now, with a scrubber. |
| `js/model/quick-add.js` | Pure: a line of plain words → a calendar entry (kind, day, time, range, weekly). |
| `js/model/chronicle.js` | Pure: a week's chronicle, the world at any moment, the time-lapse frames, seasons, which moments are new. |
| `js/model/daily.js` | Pure: today's entry, last visit, what changed, the week's rhythm, the month as a constellation, the journal. |
| `js/store.js` | In-memory study data + pub/sub; all writes. |
| `js/signals-data.js` | Conversations, unread, sending, circles, rooms, door, block, report. |
| `js/archive-data.js` | Private-bucket uploads, downloads, previews. |
| `js/world-surface.js` | The world's terrain, colour and night lights, generated once per seed in idle time and cached. |
| `js/world-gl.js` | The world in WebGL: one fragment shader ray-traces the planet, ring and moons. Continents come from the seeded textures; finer detail is made per pixel from a tiling noise sampled three ways round the sphere (fractal coasts, ridges, floes, wind-stretched cloud and cirrus, clustered city lights and roads, cratered moons). Lit like a photograph: linear light with Earth-like colours, a scattering atmosphere (blue limb, gold terminator, backlit glow), a cloud deck above the ground, filmic tone curve, dither, anti-aliased edges, and a bloom pass with 60 fps away from weak devices (`device-tier.js`). Drag to spin and tip, with momentum; speed, direction, zoom; a manual mode the film drives. |
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
| `resources` + bucket `student-resources` (**private**) | you, or members of the conversation it's shared with — and a shared file only while it is listed | path `u/<you>/…` or `c/<conversation>/…` decides scope (on R2: `o/<you>/u/…` or `o/<you>/c/<conversation>/…`, see HOSTING.md); size taken from Storage; 200 MB and 1,000 files per person, counted from Storage itself; room hosts can take shared files down |
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
