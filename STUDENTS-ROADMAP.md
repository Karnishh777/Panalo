# Panalo Students — review, reflection and roadmap

*Written 22 October 2026, after PR #31 and the removal of the Odyssey
look. Live at https://panalo-5dk.pages.dev/students/. This document looks
back at what has been built, reflects honestly on how it was built, and
sets out what comes next. ROADMAP.md is the original engineering roadmap
for Panalo as a whole; LIMITATIONS.md lists what is known not to work.*

---

## 1. Where it stands

**What it is.** A student's whole day in one place, shaped around a world
that grows as you work: focus raises the real Earth from the sea, finished
tasks light its cities, reading lights its seas, talking to people
thickens its air. Encrypted chat (the same accounts and keys as Panalo
Chat), a calendar, an archive, Drift (things worth a few quiet minutes)
and a safety centre sit around it.

**Stack.** Static site on Cloudflare Pages (no build step, ES modules),
Supabase (Postgres with row-level security, Auth, Realtime, Storage),
Cloudflare R2 for large files through one Pages Function, a GitHub Action
for keep-alive and an encrypted weekly backup.

**Size.** About 70 JavaScript modules (≈16,600 lines) and ≈9,800 lines of
CSS in `students/`; 27 database phases; 31 merged pull requests since
1 October 2026.

**Tests.**

| Suite | What it covers | Count |
| --- | --- | --- |
| `tests/migrations.test.mjs` | Every SQL phase replayed on real Postgres (PGlite), acting as signed-in users through RLS | 220 |
| `tests/students-model.test.mjs` | Pure logic: world model, timeline, focus timer, daily, chronicle, quick-add, .ics, places, globe maths | 156 |
| `tools/qa/students.mjs` | The whole app in a browser against a mock Supabase, every look, phone and laptop | 216 |
| `tools/qa/smoke.mjs` | Panalo Chat end to end | all passing |
| other `tests/*.test.mjs` | crypto, attachments, passwords, breach check, util, … | all passing |

---

## 2. What has been built

### Foundations (PRs #9–#11, 1–3 Oct)
- Phase 16–17 schema: student profiles, tasks, focus sessions, events,
  activity log, goals, archive, blocks, reports, rooms with codes and a
  host at the door.
- The shell: landing page, sign-up with a bot check and a leaked-password
  check, the birth of your universe (a cinematic intro with a synthesized
  score and recorded narration, in three device tiers), and the surfaces:
  Now, Study Room, Signals, World, Calendar, Archive, Drift, Safety.
- Moderation (phase 20): a moderator role claimed with a passphrase, a
  reports queue, notes, message removal, suspensions and an audit log.
- Cross-device settings (phase 21): preferences, world lighting, Drift and
  a running focus timer follow you to other devices.

### Law and trust (PRs #12–#16)
- Full account deletion, including files on Supabase and R2 (phase 18).
- Age and parental consent (phase 22): month and year of birth, under-13s
  refused, 13–17 wait for a parent's approval, enforced by the database;
  registration details kept 180 days after deletion, then erased.
- Security logs kept 180 days for CERT-In (phase 23), export of all your
  data, a yearly rules notice, a grievance officer, INCIDENT.md and
  LEGAL.md (a comparison with the DPDP Act and the IT Rules).
- Sign in with your username (phase 25), 10 wrong tries an hour.

### The daily loop and the world (PRs #17–#26)
- The day as a ritual (phase 24): a dawn, an intention, closing the day
  (mood, energy, one thing learned, one good thing) and a journal.
- A weekly chronicle, milestone moments, 28-day seasons and a time-lapse of
  your world growing.
- A photoreal WebGL world with a 2D fallback, moons for goals, a ring for
  showing up, aurora, weather; motion controls; postcards.
- Looks: Glass (default), Signal (black, dot-matrix, one red) and Verse
  (your day in orbit, drawn like a comic torn between universes).

### Polish and features (PRs #27–#29, 21–22 Oct)
- Phone layout across every look; 44 px hit areas; one spacing rhythm.
- Living details in each look's language: the nav marker, presses, task
  completion, numbers that count up, panels that rise in as you scroll.
- Every section gained features: quick capture on Now ("chemistry
  worksheet fri"), a numbered, reorderable checklist with a choice of
  bullets, focus a task straight from its row, a month view and .ics
  export in Calendar, World in numbers and postcards, starred and sorted
  Archive, pinned Signals, Drift interests, a safety check-up, text size
  and a 12-hour clock, keyboard shortcuts.

### The real Earth and friends (PRs #30–#31, 22 Oct)
- Your world is the real Earth: all ocean at first, the real continents
  rising from India outward as you focus (NASA Blue Marble, Black Marble,
  Natural Earth, all public domain), real city lights at night with the
  moonlit ice and desert removed.
- Sign-up codes: an address that already has an account is now told so
  (Supabase sends no code then); pasted codes with spaces work; wrong or
  expired codes are explained.
- Friends on the globe (phase 27): your city, picked by hand from 7,341
  places, shown only to friends you choose from your one-to-one chats,
  until you turn it off, for 7 days or for 24 hours; names on the globe,
  Find turns the world to face them; enforced by the database.

### This round (not yet merged at the time of writing)
- Verse now slips through every universe in turn: Glass's filmed world,
  Signal's LEDs, gilded, noir and 8-bit, each once before any repeats.
- The constellation map in Signals takes each look's own colours.
- **Odyssey removed** at the owner's request, with the whole cinema engine
  behind it (`js/cinema/`, `css/cinema.css`, the film grade in the world
  renderer). A device that had Odyssey saved opens in Glass.

---

## 3. Reflection: how it was built

An honest look at the process, by the agent that did most of the work.

### What went well
- **The database is tested as a database.** Every phase is replayed on real
  Postgres and probed as real users. That caught, before production, a
  `now()` inside a CHECK, per-row `auth.uid()` calls, a missing foreign-key
  index and a consent trigger reading a column a table doesn't have.
- **Privacy decisions were made by the database, not the UI.** Who can see
  a place, a report, a minor's data or a message is enforced in RLS and
  definer functions, so a bug in the app can't widen it.
- **Visual work was checked by looking at it.** Screenshots of every look,
  phone and laptop, before each merge, found real problems: Greenland
  rising before India, moonlit deserts glowing like cities, a seam along
  the date line, a stray "null" under the tasks.
- **Small, reviewable pull requests**, each with tests and a clear body.

### What went badly, and what to do differently
1. **Odyssey was built three times and then removed.** First a camera
   through space, then a ship's console, then a sky-god — none matched
   what was wanted, and each was a few thousand lines. *Next time:* for a
   whole new look, agree on two or three still mock-ups first (one
   screenshot each, an hour's work), and build only the chosen one.
2. **Asking too late.** "Make it a fictional god" was clarified only after
   a rebuild was already done. A design direction is the owner's call;
   ask before building, not after.
3. **The test browser misleads about visuals in motion.** Headless Chromium
   renders WebGL in software, slowly; a blank frame in a screenshot cost
   an hour of debugging that turned out to be the test machine, not the
   app. *Next time:* check animations on a real device (the live site on a
   phone) before chasing them in screenshots.
4. **Live verification is blocked.** The test browser can't reach the live
   site (certificate error); deploys were verified by comparing files
   instead. A real-device check by a person is still needed after each
   deploy.
5. **Migrations were applied outside Supabase's migration history.**
   Phases 22–26 are live but don't appear in `list_migrations`. It works,
   but the history no longer tells the truth. *Fix:* record them (see §5).
6. **Documentation drifts.** LIMITATIONS.md §9 still said there was no
   moderation UI and no age check after both shipped (corrected in this
   round). *Fix:* update the limitations file in the same PR as the
   feature.
7. **No CI.** Every suite above runs by hand. A broken test can merge.

---

## 4. Known issues and risks (by real risk)

| # | Risk | Why it matters | Fix |
| --- | --- | --- | --- |
| 1 | No CI | A regression can merge unnoticed | GitHub Action running lint, unit, model, migration and QA suites on every PR |
| 2 | Storage ceiling | 1 GB on Supabase (10 GB with R2) and files are the most used feature | Bind R2 everywhere, per-file size and type limits already exist; add a usage view for the operator |
| 3 | Moderation needs someone looking | Reports arrive in a queue nobody is told about | Email or push the moderator when a report arrives |
| 4 | Calls without TURN | Calls fail on many mobile networks | Turn on a TURN relay (Cloudflare Calls TURN or Twilio) |
| 5 | Students has no service worker or push | No offline start, no reminders when the app is closed | Register the service worker for `/students/`, add Web Push for focus end, deadlines and messages |
| 6 | Supabase leaked-password protection is off | The app checks, but the server would too | Turn it on in Authentication settings (one switch) |
| 7 | Migration history incomplete | Phases 22–26 not recorded | Record them with `apply_migration` (idempotent) |
| 8 | Fonts and the QR library from CDNs | A CDN failure degrades the look | Self-host the fonts the default look uses |
| 9 | Accessibility not audited by a person | Screen-reader and keyboard paths were tested by script only | One session with NVDA/VoiceOver; fix what it finds |
| 10 | English only | Many students in India learn in Hindi, Tamil and others | Extract strings; Hindi first |

---

## 5. Planned next (the committed backlog)

1. **Merge this round** — Verse universes, themed constellations, Odyssey
   removed (one PR).
2. **CI** — one workflow: lint, unit, model, migrations (PGlite), Students
   QA and smoke (Playwright with its bundled Chromium).
3. **Record migrations 22–26** in Supabase's history; turn on leaked-password
   protection.
4. **The logo** (asked for earlier: "we can do next").
5. **Service worker and Web Push for Students** — start offline; a
   notification when a focus block ends, a deadline nears, or a friend
   writes (each opt-in, quiet hours respected, never streak pressure).
6. **Update LIMITATIONS.md §9** in full against what now exists.

The old task "Cinema 2–8" (seven more cinematic looks) is **dropped**: it
depended on the Odyssey engine, which is gone. If a fourth look is wanted
later, start from mock-ups (see §3).

---

## 6. Ideas that would make the app better

Grouped by what they do for a student. Each keeps the house rules: a
forgiving rhythm, never streaks or guilt; private by default; minors
protected; the Study Room quiet.

### Learning, not just tracking
- **Flashcards with spaced repetition**, made from a topic or pasted
  notes; due cards appear on Now; reviewing them counts as focus.
- **Exam planner**: pick an exam on the calendar, list its topics, and get
  a gentle plan of sessions back to today that adapts when you miss one.
- **Focus insights**: your best hours and days, deep vs. scattered blocks
  (phase 26 already records it), what helps — shown monthly, not daily.
- **Notes in the Archive** (rich text, linked to a subject and a task).

### Together, safely
- **Study rooms with presence**: a shared focus timer for a circle, a quiet
  "who's focusing" list, no chat during a block.
- **Accountability pairs**: two friends see each other's intention for the
  day and a tick when it's done — opt-in, both ways, easy to end.
- **Friends on the globe, next**: a small note with your city ("exam
  week"), and time zones (their local time beside their name).

### Wellbeing
- **Break suggestions** after long sessions (a walk, water, eyes off the
  screen), tied to the existing Move and Rest logs.
- **Sleep window**: the app dims and goes quiet after a time you choose.
- **Mood over a season**, from closing the day — private, shown to you only.

### Reach
- **Hindi, then Tamil and other languages**; dates and numbers per locale.
- **Installable app**: a proper PWA (icons, offline start), then a
  Trusted Web Activity for the Play Store.
- **Lighter mode for weak phones**: the 2D world, no film, fewer effects,
  chosen automatically and switchable.

### For schools (later, and carefully)
- **Verified class spaces** with a teacher role, assignments that land on
  students' calendars, no access to students' private data.
- **A parent view** for under-18s that shows only what the student chooses
  to share — never messages, never location.

---

## 7. The complete roadmap

| When | Theme | Items | Done when |
| --- | --- | --- | --- |
| **Now** (this week) | Clean up | Merge this round; CI; record migrations 22–26; leaked-password protection on; LIMITATIONS §9 refreshed | Every PR runs all suites automatically; Supabase history lists every phase |
| **Next** (2–4 weeks) | Identity and reach | Logo and app icon; service worker for Students; Web Push (opt-in); installable PWA | Students starts offline; a focus-end notification arrives with the tab closed |
| **Next** | Learning | Flashcards with spaced repetition; exam planner | A student can plan an exam and review cards from Now |
| **Then** (1–2 months) | Together | Study rooms with presence; accountability pairs; places with notes and time zones | Two friends can focus together in a room and see each other's intention |
| **Then** | Wellbeing | Break suggestions; sleep window; season mood view | Long sessions offer a break; the app goes quiet at night if asked |
| **Then** | Reliability | TURN for calls; R2 everywhere; moderator alerts; self-hosted fonts | Calls connect on mobile data; a report pings a moderator within a minute |
| **Later** (quarter) | Languages and stores | Hindi, then Tamil; Play Store via TWA | The app runs in Hindi end to end and installs from the Play Store |
| **Later** | Schools | Verified classes, teacher role, assignments; parent view for under-18s | A teacher can set work that lands on students' calendars, with no access to their private data |

---

## 8. Working with agents on this roadmap

Claude Code's `/agents` command creates reusable sub-agents; these four
would fit this project (each a file under `.claude/agents/`):

- **qa-runner** — runs every suite (lint, unit, model, migrations, Students
  QA, smoke), reports failures with the failing check and its output, and
  never edits code.
- **migration-reviewer** — reads a new `supabase-phaseNN.sql`, checks RLS on
  every table, `(select auth.uid())` in policies, indexes on foreign keys,
  definer functions with `search_path = ''`, consent triggers, and that
  `tests/migrations.test.mjs` covers it.
- **look-auditor** — screenshots every page in every look on phone and
  laptop and lists what's broken (overflow, overlap, contrast, a stray
  "null"), with the screenshot path for each.
- **docs-keeper** — after a feature PR, updates STUDENTS.md, LIMITATIONS.md
  and this roadmap so they match the code.

A design direction for anything visual starts with mock-ups for the owner
to choose from, before any agent builds it.
