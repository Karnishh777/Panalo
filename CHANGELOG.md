# Changelog — Panalo Students

Releases of Panalo Students (`students/`), newest first. The version shown
in the app (the More sheet and the landing's footer) comes from
`students/js/version.js`; bump it together with an entry here, and tag the
merge commit `students-vX.Y.0`.

## v0.2 — next

The next release, and a big one. Its scope is set in STUDENTS-ROADMAP.md
when work begins.

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
