# Panalo Students

A calm, **private** study space for intensely curious students, at
`students/`. Since v0.2 it plans for the student: a 90-second setup asks
their board, year, subjects and day once, and the plan follows from it. It runs on the **same Supabase project and accounts as Panalo
Chat**, but it is a different product: no chat, no rooms, no profiles, no
feed. Nothing anyone does in Panalo Students is shown to anyone else (since
phase 28; Signals, rooms, join codes and friends on the globe were removed).

> A student's life is not a spreadsheet. It's a universe.

The universe here is not a skin. Each cosmic idea encodes something real,
and everything it encodes is also available in plain words.

| Idea | What it actually is | Where |
| --- | --- | --- |
| **The day orbit** | Your 24 hours as a ring, midnight at the top. Classes and events are arcs, deadlines are diamonds, focus you did is an inner ice-blue track, finished tasks are dots, the hand is now. | Now, Calendar |
| **Your world** | A planet computed from what you did. Land = focus hours (never shrinks); lights = tasks finished; aurora = making things (30 d); forests = moving and resting (30 d); glowing seas = reading (30 d); atmosphere = time logged with people (7 d); ring = 5 of 7 days; moons = goals; clouds = time away, cleared the day you return. | World, centre of Now |
| **Artifacts and strata** | Files catalogued with a type glyph and a label (what, type, size, when, previewable or not), laid down in monthly layers. | Archive |
| **Deep space at midnight** | The quietest room: one ring, one number, one task. | Study Room |
| **The day, as a ritual** | The first open of each day plays a short dawn over your own world: which day of it this is, and what changed since you were last here. Then one intention ("the one thing for today"). In the evening, closing the day takes twenty seconds: how it felt, energy, one tap for what else you did (logged to your world), one thing learned, one good thing. A closed day lights a star. | Now, World → Journal |
| **This month, in stars** | Each day of the month has a fixed place in a constellation; a day you showed up on (focus, a finished task, a log, a closed day) lights its star, joined in order. A missed day stays dark — nothing resets, there is no streak. | World |
| **Moments** | Reaching a discovery (first hour, a ring, a moon completed, a hundred pages) stops the screen for a second: a flash, its name, what it means, your world behind it. Once each, never during a focus block. | anywhere |
| **Quick add** | Type a line on Calendar — “Physics test fri 10am”, “Maths class every mon 9-10”, “Essay due 12/10” — see what it understood, press Enter. Dates are read day-first; a bare hour under 8 is the afternoon. Details… opens the full form, filled in. | Calendar |
| **Exam countdowns** | Entries of kind Exam count down on Calendar and on Now (“12 days — Physics paper 1”). | Calendar, Now |
| **A plan for today** | In the Study Room, choose 1–4 blocks; rests between them start by themselves, and the phase reads “block 2 of 3”. After each block: how deep was it? (scattered, okay, deep). This week by subject sits under your sessions. Space starts and pauses. | Study Room |

What stays conventional on purpose: the week timetable is a grid, forms are
forms, navigation is labelled words, every chart has a list beside it.

## Journeys

```
landing ──► the crossing (sign in / sign up) ──► first time? the setup (about 90 s)
                                                     │  (board, year, subjects and how each is going,
                                                     │   aim, school day, boarder or travel, sleep,
                                                     │   tuition, exams coming up)
                                                     ▼
                                Now ◄──► Study · World · Calendar · Archive
                                         Privacy & data · Settings     (Warp: Ctrl/⌘ K)
```

- **Landing** (`#top`): what it is, who it's for, why, what's inside (with a
  live world demo driven by the real model), the product in four honest
  numbers, a letter, safety facts, questions answered, footer. Around it
  (`js/landing-hud.js`): a HUD with the current chapter and scroll progress, the thread (a star per
  chapter down the right edge, lit as you pass, each a link), and headings
  that decode as they arrive. All of it steps aside for reduced motion. `#login`
  and `#signup` open the crossing; `#join=CODE` remembers an invite through
  sign-in.
- **Calm by default; your work first.** Panalo is a place to get work done,
  so nothing moves on its own unless you ask: drifting petals, press
  bursts, counting numbers, Verse's spray, glitches and slips are
  Settings → Display → **Lively effects** (off by default; `data-effects`
  on `<html>`, `js/motion.js` `lively()`). The top of Now is always the
  **next step** — the running block, else the task due soonest, else a
  25-minute start — one button away from focusing.
- **The focus shield** (`js/focus-shield.js`): while a focus block runs,
  wherever you are in the app, unread counts are hidden, nothing
  celebrates and no dawn or weekly story plays, and one quiet line under
  the bar says what you're on and how long is left, linking back to the
  Study Room. A paused block isn't shielded.
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
    universe's style -- Glass's filmed world, Signal's LEDs, gilded, noir or
    8-bit, each once before any comes round again -- with a label saying
    which.
  - Now: **Capture** a task in one line under the greeting ("Chemistry
    worksheet fri" -- the date is read from the words, `model/quick-add.js`);
    a ▶ on each task in Due soon starts a focus block on it
    (`#/study/focus=<id>`).
  - Study Room: the task list is a **checklist** -- numbered, bulleted or
    plain; in your own order (drag by the grip, or the arrow keys on it) or
    by due date (`prefs.taskSort`, `taskMarks`, `taskOrder`); edit a task's
    name, subject and date; filter by subject; **twelve weeks of focus** as
    a map of days (a picture, not a streak).
  - Calendar: a **month** view; **download your calendar** as an .ics file
    (weekly classes repeat; open tasks with a date come as deadlines;
    `model/ics.js`, tested).
  - World: **your world in numbers** (age, focus, best day, longest
    session, lights, logged time, moons); a **postcard** -- your world, its
    name, day and numbers as an image saved to your device (nothing is
    posted, nothing shared).
  - Archive: **stars** (a Starred shelf on top), **sort** (newest, oldest,
    A–Z, largest), a storage meter.
  - Safety: **Need help now?** -- 112, CHILDLINE 1098, Tele-MANAS 14416,
    cyber crime 1930, each a tap to call; a **safety check-up** you tick
    for yourself.
  - Settings: **Display** -- text size (four steps, applied before the
    first paint) and a 12-hour clock; **keyboard shortcuts** (? lists them;
    g then a letter goes to a page; also in Warp).
- **Living details** (`js/details.js`, `css/details.css`), each in the
  look's own language, none with reduced motion:
  - the nav's marker glides to where you're going (a glass pane with a
    sheen in Glass, a red dot that stretches into a dash in Signal;
    Verse's torn tab slams into place), on
    the phone dock too;
  - a press answers where your finger landed (a bloom of light, a ring
    of LEDs, a comic burst);
  - ticking a task off plays a moment at the box (motes of light,
    scattering pixels, a lettered DONE!) --
    only a quiet ring in the Study Room;
  - numbers count up when a page arrives and roll when they change;
  - cards lean towards the pointer (Glass);
  - panels below the fold rise in as you scroll to them (never one
    already on screen); a line under the bar shows how far down the page
    you are;
  - notices and loading lines in each look's style (a speech balloon in
    Verse, an LED strip in Signal); Signal's clock colon blinks.
- **Details and phones** (`css/phone.css`, loaded last, for every look):
  one 16 px rhythm between panels on phones; a page's actions grouped the
  way a thumb reaches them (Calendar's Day/Week, day stepper and + in one
  row; World's main action across the width with the rest in an even
  row; Study's controls each under a label); 44 px hit areas on panel
  links and list rows; the Now dial's key two by two; the landing bar
  that always fits (down to 360 px); headings balanced so no word is
  left alone on a line.
- **Effects with a purpose**: ink, petals and button hits only on Now
  and World. Calendar, Archive, Settings, Privacy & data and
  Moderation stay still; the Study Room is the quietest of all.
- **Settings follow you** (`js/sync.js`, phase 21): preferences, lighting
  and a running timer, newest change wins.
- **Crossing**: an event horizon beside an airlock form. Crossing over
  collapses the horizon into the app. Handles login, sign-up (+ email code),
  forgot password, the unlock prompt, and password recovery — with exactly
  the key handling of Panalo Chat (`src/auth.js`).
- **The setup** (`js/setup.js`, v0.2): replaces the old intro film. One
  question a screen, mostly one tap each: board (Cambridge, CBSE, other),
  year (Grade 9, Grade 10, AS, A2; or CBSE Class 9 to 12), subjects from
  the board's own list with syllabus codes (`model/subjects.js`), how each
  is going (struggling to strong) and an optional last grade, the aim, the
  school days and hours, boarder or day scholar (with travel time), wake
  and sleep, tuition hours, and any exams coming up (added to Calendar).
  Saved to the study profile (phase 29, `model/profile.js`); Next says
  what's missing instead of moving on. Settings → Your study profile
  reopens it to change the answers.
- **Navigation**: top bar on wide screens, a five-item dock on phones (Now,
  Study, Calendar, World, More). **Warp** (Ctrl/⌘ K) jumps anywhere or does
  common things ("Start a 25-minute focus", "Add a task").

## Architecture

- **No build step**, like Panalo Chat: ES modules served as files.
  `students/index.html` loads the Supabase SDK and `../crypto.js` as classic
  scripts, then `students/js/main.js`. Surfaces load on first visit
  (`import()`), so opening the app costs Now and nothing else.
- **Reused from Panalo Chat** (`src/`): the Supabase client, auth storage,
  the account's key handling (`encryption.js`: kept in step when you sign
  in or change your password, so Panalo Chat keeps working with the same
  account), `password.js`, `filekind.js`, `filestore.js`, `util.js`
  (`el()` — every string is rendered with `textContent`).
- **Pure models** (`students/js/model/`), unit-tested in
  `tests/students-model.test.mjs`: `world-model.js`, `timeline.js`,
  `focus-timer.js` (timestamps, not ticks — survives reloads and sleep),
  `subjects.js` (boards, years and subjects), `profile.js` (the study
  profile), `safe-type.js`.

| File | Role |
| --- | --- |
| `js/main.js` | Outside → crossing → the setup (first time) → inside. |
| `js/setup.js` | The 90-second setup that fills the study profile. |
| `js/model/subjects.js` | Pure: boards, years, subjects (with Cambridge syllabus codes) and grade scales. |
| `js/model/profile.js` | Pure: the setup's answers as a study-profile row and back. |
| `js/auth.js` | Sign-in, sign-up, unlock, recovery, sign-out. |
| `js/fx.js` | Hand-drawn action effects: speed lines, impact frames, punches, ink-slash reveals, water and flame ribbons, petals and embers. Off in the Study Room and with reduced motion. |
| `js/globe-dock.js` | A world's controls: play/pause, direction, speed, zoom, reset, and the light panel. |
| `js/world-light.js` | Where the sun is (Day, Dusk, Night, Live with your clock, or by hand) and how bright the night side is; saved per device, shared by every globe. |
| `js/shell.js` | Router, top bar, dock, account menu, Warp. |
| `js/dawn.js` | The first seconds of each day: a sunrise over your world, the day number, what changed since your last visit, then one question. Once a day across devices (daily_entries.opened_at). |
| `js/checkin.js` | The morning intention and closing the day. |
| `js/moment.js` | A full-screen moment for each new discovery, once each (seen ones follow your preferences across devices). |
| `js/model/quick-add.js` | Pure: a line of plain words → a calendar entry (kind, day, time, range, weekly). |
| `js/model/chronicle.js` | Pure: a week's numbers (for the weekly report), which moments are new. |
| `js/model/daily.js` | Pure: today's entry, last visit, what changed, the week's rhythm, the month as a constellation, the journal. |
| `js/store.js` | In-memory study data + pub/sub; all writes. |
| `js/archive-data.js` | Your own files: private-bucket (or R2) uploads, downloads, previews. |
| `js/world-surface.js` | The world's terrain, colour and night lights, generated once per seed in idle time and cached. |
| `js/earth.js` | The world is the real Earth. A new world is all ocean; focus raises the real continents in their true shapes, starting in India and spreading outward (each landmass from its interior to its coast), until about 200 hours raises all of it (`layers.earth`, `model/world-model.js`). Finished tasks light Earth's real cities on the night side, brightest first (`layers.cities`). Three maps per size in `assets/earth/` (2048 px, or 1024 on weak devices): surface colour from NASA's Blue Marble (topography and bathymetry, July 2004), night lights from NASA's Black Marble 2016 with the moonlit ice and desert taken out, and the order land rises, from Natural Earth's 1:10m land polygons. All three sources are public domain. Rebuild with `python3 -I tools/earth/build_earth.py <sources> students/assets/earth` (the script's header lists the source URLs). |
| `js/world-gl.js` | The world in WebGL: one fragment shader ray-traces the planet, ring and moons. Continents come from the seeded textures; finer detail is made per pixel from a tiling noise sampled three ways round the sphere (fractal coasts, ridges, floes, wind-stretched cloud and cirrus, clustered city lights and roads, cratered moons). Lit like a photograph: linear light with Earth-like colours, a scattering atmosphere (blue limb, gold terminator, backlit glow), a cloud deck above the ground, filmic tone curve, dither, anti-aliased edges, and a bloom pass with 60 fps away from weak devices (`device-tier.js`). Drag to spin and tip, with momentum; speed, direction, zoom; a manual mode the film drives. |
| `js/world-render.js` | Picks WebGL when the GPU is real, otherwise the 2D canvas globe; same `setLayers()` contract either way. |
| `js/dayorbit.js` | The SVG day orbit. |
| `js/ambient.js` | Generated study sound (Web Audio, no files). |
| `js/surfaces/*.js` | Now, Study, World, Calendar, Archive, Privacy & data (`safety.js`), Settings, Moderation. |
| `css/tokens.css` … `surfaces.css` | The design system (below). |
| `privacy.html`, `rules.html` | Plain-language privacy notes and rules. |
| `mark.svg`, `favicon.svg`, `icon-*.png`, the `#mark-glass` / `#mark-signal` / `#mark-verse` symbols in `index.html` | The logo, **Ascent**: a p whose bowl is a small world and whose stem is a beam of focus rising into it, with a bead of light in orbit. Every `<svg class="mark">` holds all three materials and `public.css` shows the one for the current look (Glass: light and glass; Signal: red LEDs with the p's counter cut out; Verse: ink, halftone and a cyan/magenta misprint). With Lively effects the mark in the bar glows slowly (never with motion reduced). `mark.svg` is the full mark on its tile (app icon, privacy and rules pages); `favicon.svg` a simpler cut for tabs; `icon-180/192/512.png` and `icon-maskable-512.png` the home-screen icons. `og.jpg` is the sharing image (the landing at 1200×630). The version shown in the app is `js/version.js` (see CHANGELOG.md). |

## Data (phases 16 and 17 — `supabase-phase16.sql`, `supabase-phase17.sql`)

| Table | Who can read | Notes |
| --- | --- | --- |
| `student_profiles` | you | world name, interests, born_at |
| `student_tasks`, `focus_sessions`, `student_events`, `activity_log`, `student_goals` | you | capped per person; a focus session can't claim more minutes than elapsed, or point at someone else's task |
| `resources` + bucket `student-resources` (**private**) | you (Students lists only your own files) | path `u/<you>/…` (on R2: `o/<you>/u/…`, see HOSTING.md); size taken from Storage; 200 MB and 1,000 files per person, counted from Storage itself |
| `reports` | the sender (and the operator) | in Students, only questions and requests about your data (Privacy & data); status can't be set by the sender; 20 a day |

The tables phase 16 added for Students' chat (`room_codes`,
`room_requests`, `blocks`, conversation kinds) are still in the database,
because Panalo Chat and the replayed tests name them; Students no longer
uses them, and phase 28 emptied every join code. Phase 28 dropped
`student_places` and `student_place_viewers` (friends on the globe) with
their data.

Every rule above is replayed against real Postgres in
`tests/migrations.test.mjs` (49 Students tests, phase 17 included).

## Security and privacy decisions

- **Private by construction.** Students has no surface that shows one
  person's data to another: no chat, no profiles, no presence, no shared
  files. The Archive asks for your own files only.
- **Archive files never get a type from the uploader.** A `blob:` URL runs
  with the app's origin, so `safe-type.js` maps every file to a type that
  cannot execute (an HTML file labelled `.pdf` is opened as a PDF, SVG is
  bytes). Tested.
- **`_headers`** gained `blob:` in `connect-src` (reading back a blob the app
  created itself). Nothing else in the CSP changed.
- **No AI, no analytics, no third-party scripts** beyond the Supabase SDK.

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
- **Responsive**: top bar ≥ 900 px, dock below;
  the week grid becomes a list; dialogs become bottom sheets.

## Testing

```sh
npm ci --prefix tools/lint && npm ci --prefix tools/sqltest && npm ci --prefix tools/qa
tools/lint/node_modules/.bin/eslint -c tools/lint/eslint.config.mjs --no-config-lookup students/js src crypto.js sw.js tools/qa
node tests/students-model.test.mjs   # world, timeline, timer, subjects, study profile, safe types
node tests/migrations.test.mjs       # every phase's RLS, against real Postgres
node tools/qa/students.mjs           # the whole app in Chromium, against the mock
node tools/build-supabase-all.mjs --check
```

All of these run on every pull request and every push to `main`
(`.github/workflows/tests.yml`).

## Not done yet (see LIMITATIONS.md §9)

Verified teacher/school roles · push notifications (Web Push) · moderator
alerts outside the app · end-to-end encrypted archive · per-project storage
quota · Yearbook-style letters that unlock later.
