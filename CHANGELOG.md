# Changelog — Panalo Students

Releases of Panalo Students (`students/`), newest first. The version shown
in the app (the More sheet and the landing's footer) comes from
`students/js/version.js`; bump it together with an entry here, and tag the
merge commit `students-vX.Y.0`.

## v0.2 — in progress

Panalo Students becomes a second brain: it asks once, plans for the
student, and shows results. The plan is in STUDENTS-ROADMAP.md; Pan, the
AI, runs as "Pan Lite" (our own planner code does the planning; the AI
only where nothing else can).

**0.2.0 (in progress)**
- **Removed**: the intro film (with its score, voice-over and finale),
  the 0-to-100 gate on the landing, Drift, the weekly chronicle film,
  seasons, the time-lapse, and the link to Panalo Chat.
- **The setup**: about 90 seconds, one question a screen: board
  (Cambridge, CBSE, other), year (Grade 9, Grade 10, AS, A2; CBSE 9-12),
  subjects with their syllabus codes, how each is going, the aim, the
  school day, boarder or day scholar, sleep, tuition and exams coming up.
- **Phase 29**: the study profile in the database; Drift's saved state
  erased.
- **Question bank**: 689 checked multiple-choice questions over 18
  Cambridge syllabuses (IGCSE 0625, 0620, 0610, 0580, 0478, 0455, 0450,
  0452; AS & A Level 9702, 9701, 9700, 9709, 9708, 9609, 9618, 9706,
  9990, 9699), each with a one-line explanation (`students/assets/syllabus/`).
- **The planner's core** (not on screen yet): per-topic mastery (Elo),
  memory (FSRS-6) and per-subject pace, and how much study each day really
  has room for (sleep as a hard limit, caps, one lighter day, a 20%
  buffer). Defaults come from the research behind the planner.

## v0.1 — 23 October 2026 · first release

The first release of Panalo Students: a calm, private study space where a
student's work grows a world of their own. Live at
https://panalo-5dk.pages.dev/students/.

**What is in it**
- **Now**: the day at a glance — the next thing to do, an intention for the
  morning, closing the day, a forgiving rhythm (never streaks), and the
  weekly chronicle.
- **Study**: a quiet focus room with a timer that keeps running across
  devices, and a focus shield that holds everything else back.
- **Calendar**: timetable, deadlines and exams; quick-add in plain words;
  `.ics` import and export.
- **World**: a real Earth that rises from the sea as you focus, lights its
  cities as you finish tasks and its seas as you read; seasons, milestone
  moments and a time-lapse.
- **Archive**: your own files (stored in Cloudflare R2); nobody else sees them.
- **Drift**: three things worth a few quiet minutes.
- **Privacy & data**: what is stored, a check-up, help lines, export your
  data, ask a question or make a request, delete your account.
- **Three looks**: Glass, Signal and Verse, with calm effects by default
  and Lively effects on request; reduced motion respected everywhere.
- **Private by design**: no chat, rooms, friends, presence or public
  profile; nothing anyone does is shown to anyone else (phase 28).
- **Safety and law**: birth date at sign-up, parental consent for under-18s
  (DPDP Act), 13+ only, a grievance officer, yearly rules notice, leaked-
  password check, captcha, full account deletion.
- **The logo, Ascent**: a p whose bowl is a small world and whose stem is a
  beam of focus rising into it, with a bead of light in orbit. One shape in
  three materials that follow the look — light and glass in Glass, red LEDs
  in Signal, ink and halftone in Verse — plus a simpler cut for browser
  tabs, home-screen icons (including a maskable one) and a new sharing
  image.

**Behind it**: 28 database phases with row-level security, every suite run
on every pull request (`.github/workflows/tests.yml`), an encrypted weekly
backup. Known gaps are in LIMITATIONS.md.
