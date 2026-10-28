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
- **The plan**: a new Plan page and today's plan on Now. Panalo plans
  the week in blocks (quick check, learn, practice, review) that fit each
  day, mixes subjects, eases off before exams, and re-plans by itself.
  Every block ends with a short check whose answers are explained straight
  away; results can be added and pull the plan towards what they show.
  "Not sure? Pick from three" for when choosing is the hard part.
- **Phase 30**: progress per topic, pace per subject, results.
- **Boarders** (phase 31): the setup asks for the evening prep time, and
  school-day blocks are planned inside it.
- **Customize the plan** (phase 32): tell Pan ("Sundays off, only an hour
  on Saturday, more maths") and see what will change before it applies,
  or set it yourself: each day off or capped, nothing before a time, each
  subject paused, less, normal or more. Any block can be skipped or pulled
  into today. Your changes are listed, each undoable, with Reset all.
  Pan is `functions/api/pan.js` (Claude Haiku, `ANTHROPIC_API_KEY`
  secret); without it, simple sentences are understood in the app.
  Each student can ask Pan 30 times a day (phase 33), so the AI bill
  can't run away.
- **Guardians step forward**: the chosen one grows into colour with its
  subject's live effect (circuits and data for computing, arcs for
  physics, bubbles for chemistry, a helix for biology ...), the others
  wait small, grey and faint. The landing gets the cast too.
- **The rest of the week** (phase 34): the setup asks for sport, art,
  music and coaching at set times (days, from, to). The plan keeps those
  times clear, with a little time to get there and back, and so does any
  calendar entry with times (a class, a function, a trip): the day holds
  less, nothing is placed over it, and something long gets a rest after
  it. "Busy today? Take it off" on the Plan page; a crash day (up to six
  hours, sleep still protected) for any date, by hand or by telling Pan;
  and when yesterday didn't happen, the plan says it has re-planned.
- **Lighter and steadier**: the painted art is re-exported at the size it
  is shown (guardians 720 px, Pan 512, scenes 1600, walls 1920): about
  88 MB of decoded images instead of 227, 4.9 MB to download instead of
  13. The landing's two WebGL worlds exist only while the landing is on
  screen; sign-up, the setup and the app stop them and free the GPU
  memory (a low-memory laptop hung making an account). The guardian
  effect is now one quiet circuit trace in the subject's colour that
  plays a few seconds after a choice and then holds still, with a
  smaller zoom.
- **Only studying grows the world (phase 37)**: land is study time (focus
  sessions and exam-style questions); forests spread as chapters are
  covered and stay; the seas glow with the chapters known to your aim;
  the aurora is the marks earned in the last 30 days (exam-style
  questions you marked and past papers); the atmosphere thickens with
  each past paper in the last 60 days; the ring needs five study days of
  seven; and mist gathers over chapters due for review, clearing as they
  are reviewed (weather, never loss). Reading, making, moving, resting
  and time with people no longer shape it: "Log an activity" is gone from
  World and from closing the day, which keeps mood, energy and what you
  learned. Each exam-style question marked is kept (`activity_log` kind
  `questions`, with its marks).
- **Timetable (phase 36)**: Plan shows today in full, with times; other
  days come up by tapping them (or "The whole week"), and the choice is
  remembered on the device. Boarders give every study time the school
  keeps (evening prep, morning prep, night study, weekend prep, each on
  its days) and the plan uses all of it, with no buffer taken off: an
  evening prep of 90 minutes was planned as 70 before. Short blocks run
  together, with a break after each 25 minutes or more. Boarders say how
  weekends go (in the hostel, at home, or it changes); going home, the
  evening of leaving is the journey, and the last day ends early for the
  journey back; staying, the weekend is study time with any weekend prep
  in full. When weekends change, Plan asks about each coming weekend, and
  Pan understands "I'm going home this weekend".
- **Your journey (phase 36)**: Settings → Your journey downloads
  everything done here as one file, starts again from nothing (after a
  last chance to download, and typing "start again"), or brings a
  download back. The database seals each download to its account
  (`journey_export`), so a journey can only come back into the account it
  came from, and only as it was downloaded; "Download my data" carries the
  same sealed journey.
- **Other subjects (phase 35)**: the subject list (at sign-up and in
  Settings → Change my answers) has "+ Other subject": a name and its
  syllabus code ("Marine Science 9693"). Pan works out the syllabus
  (`functions/api/pan-subject.js`: board, name, code and its topics in
  order, marked AS or A Level; when Pan isn't sure it says so and gives
  its best guess) and the plan works through those topics like any other
  subject. Plan's subject card shows what Pan found, and its topics can be
  checked, renamed, removed or added (each keeps its progress). Without
  Pan (no key, offline, the day's asks used) the subject is still added,
  as blocks of your own work. A subject that's already listed points back
  to the list. Up to six; kept in `student_profiles.custom_syllabi`. Blocks
  on a topic with no questions now ask how it went.
- **Papers and exam series**: each subject knows its papers (every
  IGCSE and AS & A Level syllabus in the app: 9709 Paper 1 Pure
  Mathematics 1 … Paper 5 Probability & Statistics 1; 9702 Paper 1
  Multiple Choice, Paper 2 AS Structured, Paper 3 Practical; with each
  paper's kind, length and marks, `js/model/papers.js`). The setup asks
  which papers and which series (February/March, May/June,
  October/November), with the usual route chosen; Plan's subject cards
  change them and take each paper's date. The plan studies only what the
  chosen papers examine, counts each topic down to its own paper, and in
  the last six weeks fits in timed past papers (the paper's full time in
  the Study Room, then its marks, saved on the paper's topics).
- **Exam-style questions**: original written questions with their marks
  [n], a mark scheme to tick yourself against (M1/A1/B1, C1/A1), and
  diagrams (tree diagrams, the normal curve, a sector, v–t graphs, a
  circuit…), by paper, by marks (1–2, 3–4, 5+) and by topic: 9709 Pure 1,
  Probability & Statistics 1 and Mechanics, 9702 AS, 0580; and (138 in
  all) every other subject's theory papers: 9701, 9700, 9708, 9609, 9618,
  9706, 9990, 9699 (AS), and 0625, 0620, 0610, 0455, 0450, 0478, 0452. Each mark
  moves its topic. 9709's Mechanics and Probability & Statistics 1 are
  now split into their syllabus sections, with new checked questions.
- **Subject check-in**: Plan offers, for each subject, a two-minute
  check-in (straight after the setup, and any time after to redo it):
  past exams first (what it was, got, out of), then either a quick
  check-over (how much school has taught, and how it's going) or, if the
  student wants, chapter by chapter (not taught yet / weak / okay /
  strong), each with an optional quick check of three questions that
  corrects the rating. Untaught chapters get learn blocks, weak ones
  practice and early reviews, strong ones later reviews, staggered so
  they don't all fall due on one day (`js/model/diagnose.js`,
  `js/check-in.js`). A result now saves all its topics in one request.
- **Faster**: the starfield behind the app holds still inside it (it was
  repainting the whole page every frame); hidden pages no longer redraw on
  every change, and visible ones at most once a frame; the world turns at
  half the frames when effects are calm; the browser fetches every module
  at once (`modulepreload`, kept in sync by `tools/preload.mjs`) and
  doesn't wait on scripts to draw the page; a machine that drops frames
  gets a lighter finish (no backdrop blur, looping animations play once).
- **UI audit fixes** (a full pass over every page, phone and laptop):
  - **Phones:** Settings and World no longer scroll sideways, and every page fits a 320 px screen.
  - **Landing:** all eight guardians load on phones (art images now know their size before they load). The chapter label no longer reads "The cast" over the hero. Phones get the tall wallpaper, and scenes load only when near.
  - **Lite mode:** bars and docks turn solid when the blur is off.
  - **Plan's heading** sits together.
  - **The setup's step count** no longer jumps from "1 of 9" to "2 of 10".
  - **Now and Calendar** say the study blocks are on the Plan instead of "nothing scheduled". Quick-add asks for a time instead of guessing 9 am.
  - **The landing** no longer claims "no AI": Pan uses it when asked.
  - **Older browsers:** `:has()` is gone, and color-mix, backdrop blur, dvh and randomUUID have fallbacks.
  - **Arrow keys** move through every chip and segment group.
  - **Touch targets** are at least 24 px.
  - **Reduced motion:** the button glint no longer loops when motion is reduced.
  - **Globes:** the turning worlds draw about 30 frames a second when calm and 10 on a slow machine, and the landing checks for a slow machine too.
- **Forge**: the app's default look gets a finish of its own: poster
  type, cut-corner plates with an ember notch, slanted ember buttons,
  segmented meters, diamonds for topics, a film grain.
- **The painted art is in**: the eight subject guardians, Pan's four
  poses, eight scenes and both wallpapers (originals in `art-source/`,
  web versions made by `tools/art/process.py`: green cut out, corner mark
  removed, near-lossless WebP). The Plan stage is a lineup of the cast;
  the wallpaper's ember river sits behind Now and Plan.
- **Coded motion art** (`js/motion-art.js`, live canvas, no files): Pan
  the mascot (a molten star with a flame crown; waves, blinks, cheers in a
  burst of sparks after a good check, thinks, dozes in idle mode), eight
  animated subject emblems on the Plan page (the chosen one plays large in
  its colour above a strip of still black-and-white ones), and embers
  rising behind Now and Plan (moving with Lively effects only). Only what
  is on screen animates; reduced motion gets still frames.
- **The painted art** (slots ready, images coming): Pan the mascot, eight
  subject guardians in a lineup on the Plan page (black and white until
  chosen, then colour, glow and their scene behind), wallpapers behind Now
  and Plan. Prompts in `students/assets/art/PROMPTS.md`; drop images in
  with `python3 -I tools/art/process.py <folder>`. Each subject's colour is
  now its guardian's.
- **Now, around the plan**: the next block leads, in its subject's colour;
  today's focus folds into today's plan; left alone for two minutes, Now
  fades to just your world and its day (any touch brings it back).
- **12-hour clock everywhere**: the setting now also covers the plan, the
  day orbit, the calendar's hours, the study profile, the setup's wake and
  sleep times and moderation dates, and redraws the open page at once.
- **The planner's core**: per-topic mastery (Elo),
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
