// The weekly plan (v0.2): which topic, what kind of block, how long, on
// which day. Pure (tests/plan.test.mjs). It is rebuilt from the student's
// state every time it is shown, so missing a day, a test mark or a quick
// check all re-plan by themselves -- nothing is ever "behind".
//
// Four kinds of block, from the research behind the planner:
//   check     10 min. A topic not touched yet: a few questions to find out
//             what is already known (the cold start is a short diagnostic,
//             not a guess). Known → it goes to review; not → to learn.
//   learn     25 min. New material, then a short check. Worked examples
//             first; the check is the first retrieval.
//   practice  25 min. Covered, but below the aim: questions with feedback.
//   review    15 min. Due by the memory model: a short self-test.
//   topical   15-50 min. Practice once a chapter is half known (or its exam
//             is within six weeks) and it has exam-style questions: a set
//             of them on one paper, timed at that paper's pace, then
//             marked with the scheme ("Physics P2 · Ch 2 Kinematics ·
//             topical Q1-3 (12 marks) · 25 min").
//
// The week is filled day by day up to each day's capacity (capacity.js),
// inside a boarder's study times when the day has them, with a 5-minute
// break after each block of 25 minutes or more (short ones run together),
// best block first, with two rules: no subject takes more than half a
// day's time (at least 50 minutes), and each block a subject already has
// that day makes its next one a quarter less urgent, so subjects are
// mixed; never the same topic twice in a day, and at most three quick
// checks in a subject a day.
// Nothing new in a subject in the last two days before its exam; nothing
// at all for it on the exam day.
import * as L from "./learner.js";
import { dateCapacity, activitiesOn, busyWithin, dinnerOn, caps } from "./capacity.js";
import { stageOf, subjectName } from "./subjects.js";
import { minutesOf, cleanRoutine } from "./profile.js";
import * as R_ from "./rules.js";
import * as PP from "./papers.js";

const DAY = 86400000;
const BREAK = 5;
const CRASH = 360; // minutes a crash day may hold
// Calendar entries that take the student's time (deadlines don't, and a
// study entry is study).
const BLOCKING = new Set(["class", "event", "personal", "exam"]);

/**
 * When a day is already taken: fixed activities (profile) and calendar
 * entries with times, as intervals in minutes since that day's midnight.
 * A weekly entry counts on its weekday from its first date on.
 */
export function busyOf(profile, events, dayStart) {
  const date = new Date(dayStart);
  const out = activitiesOn(profile, date.getDay());
  const dinner = dinnerOn(profile);
  if (dinner) out.push(dinner);
  const end = dayStart + DAY;
  for (const e of events || []) {
    if (!BLOCKING.has(e.kind)) continue;
    const s = new Date(e.starts_at);
    const en = e.ends_at ? new Date(e.ends_at) : new Date(s.getTime() + 3600000);
    // Time to get there and back; after something long, a rest as well.
    const pad = (a, b) => out.push([a - 15, b + (b - a >= 180 ? 45 : 15)]);
    if (e.repeat_weekly) {
      if (s.getDay() !== date.getDay() || s.getTime() >= end) continue;
      const a = s.getHours() * 60 + s.getMinutes();
      pad(a, a + Math.max(15, (en - s) / 60000));
    } else if (en.getTime() > dayStart && s.getTime() < end) {
      pad(Math.max(0, (s.getTime() - dayStart) / 60000), Math.min(1800, (en.getTime() - dayStart) / 60000));
    }
  }
  return out;
}

/** Mastery each aim plans towards. */
export const TARGET = { pass: 0.6, good: 0.75, top: 0.88 };

export const KINDS = {
  check: { label: "Quick check", minutes: 10, verb: "Find out what you know" },
  learn: { label: "Learn", minutes: 25, verb: "Learn it, then a short check" },
  practice: { label: "Practise", minutes: 25, verb: "Questions with answers explained" },
  review: { label: "Review", minutes: 15, verb: "A short self-test before it fades" },
  // A whole paper, timed, then marked with its scheme (minutes vary by paper).
  paper: { label: "Past paper", minutes: null, verb: "A timed paper, then marked with the scheme" },
  // A chapter's exam-style questions on one paper (minutes vary by set).
  topical: { label: "Topical questions", minutes: null, verb: "Exam-style questions on this chapter, timed, then marked with the scheme" },
};

// Topical sets: minutes a mark when the paper's own pace isn't known (as
// exam-questions.js logs them), time to mark, and the length of a set.
const MIN_PER_MARK = 1.5;
const MARKING_MINUTES = 5;
const TOPICAL_MIN = 15;
const TOPICAL_MAX = 50;
// Practice turns topical from this mastery, or this close to the exam (days).
const TOPICAL_MASTERY = 0.5;
const TOPICAL_WINDOW = 42;

/** "Ch 2" for a numbered chapter; a coded one (P1.2) as it is; "" for own work. */
export function chapterOf(id) {
  if (!id || id === "*" || String(id).startsWith("paper-")) return "";
  return /^\d+(\.\d+)*$/.test(id) ? `Ch ${id}` : String(id);
}

/**
 * A topical set for chapter `tp`: its exam-style questions on one paper
 * (of the student's papers, the one with the most marks not yet done),
 * questions not done lately first (`asked`, as for checks), as many as fit
 * TOPICAL_MAX minutes but at least one. null when it has none.
 */
export function topicalSet(tp, { code = null, papers = [], asked = [] } = {}) {
  const pool = (tp?.long || []).map((q, i) => ({ ...q, key: `${tp.id}#${i}` })).filter((q) => !papers.length || papers.includes(q.paper));
  if (!pool.length) return null;
  const done = new Set(L.cleanAsked(asked).map(([id]) => id));
  const fresh = pool.filter((q) => !done.has(L.questionId(q)));
  const marksBy = new Map();
  for (const q of fresh.length ? fresh : pool) marksBy.set(q.paper, (marksBy.get(q.paper) || 0) + q.marks);
  const [[paper]] = [...marksBy].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const p = PP.paperOf(code, paper);
  const rate = p?.minutes && p?.marks ? p.minutes / p.marks : MIN_PER_MARK;
  const picked = [];
  let marks = 0;
  for (const q of L.staleFirst(pool.filter((q) => q.paper === paper), asked)) {
    if (picked.length && (marks + q.marks) * rate + MARKING_MINUTES > TOPICAL_MAX) break;
    picked.push(q);
    marks += q.marks;
  }
  const minutes = Math.min(TOPICAL_MAX, Math.max(TOPICAL_MIN, Math.ceil((marks * rate + MARKING_MINUTES) / 5) * 5));
  return { paper, keys: picked.map((q) => q.key), ids: picked.map(L.questionId), count: picked.length, marks, minutes };
}

/** Whether practice on a topic should be a topical set: half known, or its exam near. */
export const preferTopical = (t, daysToExam) => L.mastery(t) >= TOPICAL_MASTERY || daysToExam <= TOPICAL_WINDOW;

/** A block's heading: its chapter and topic (a paper's or own work's name as it is). */
export function blockTitle(b) {
  if (b.own) return b.subjectName;
  if (b.kind === "paper") return b.topicName;
  return [b.chapter ?? chapterOf(b.topic), b.topicName].filter(Boolean).join(" ");
}

/** What the block asks for: "topical Q1–3 (12 marks)", or its kind. */
export function blockTask(b) {
  if (b.kind !== "topical") return KINDS[b.kind]?.label || "";
  const qs = b.count > 1 ? `Q1–${b.count}` : "Q1";
  return `topical ${qs} (${b.marks} mark${b.marks === 1 ? "" : "s"})`;
}

/** The subject, with the paper a topical block targets: "Physics P2". */
const subjectPart = (b) => `${b.subjectName}${b.kind === "topical" && b.paper ? ` P${b.paper}` : ""}`;

/** The line under a block's heading: "Physics P2 · topical Q1–3 (12 marks)". */
export const blockSub = (b) => (b.own ? KINDS[b.kind]?.verb || "" : `${subjectPart(b)} · ${blockTask(b)}`);

/** All of it on one line: "Physics P2 · Ch 2 Kinematics · topical Q1–3 (12 marks) · 25 min". */
export function blockLabel(b) {
  if (b.own) return [b.subjectName, KINDS[b.kind]?.label, `${b.minutes} min`].filter(Boolean).join(" · ");
  return [subjectPart(b), blockTitle(b), blockTask(b), `${b.minutes} min`].filter(Boolean).join(" · ");
}

// Past papers start this long before a paper's date, this often (days).
const PAPER_WINDOW = 42;
const paperGap = (daysLeft) => (daysLeft <= 14 ? 4 : 8);

const LEVEL_BOOST = { 1: 1.3, 2: 1.15, 3: 1, 4: 0.9 };

/** Where a subject's question bank lives, or null if there is none yet. */
export function syllabusPath(stageId, subjectId) {
  const level = stageOf(stageId)?.level;
  const dir = level === "igcse" ? "igcse" : level === "as" || level === "a2" ? "alevel" : level === "icse" ? "icse" : null;
  return dir ? `assets/syllabus/${dir}/${subjectId}.json` : null;
}

/**
 * The topics a student studies: those their chosen papers examine; with no
 * papers chosen, AS students the AS half and others all of it.
 */
export function topicsInScope(syllabus, stageId, papers = []) {
  if (!syllabus?.topics?.length) return [{ id: "*", name: "Your own work", questions: [] }];
  // An ICSE class studies its own year's chapters (a topic's stage "9" or "10").
  const year = { icse9: "9", icse10: "10" }[stageId];
  const inYear = (t) => !year || !t.stage || t.stage === year;
  const byPapers = papers?.length ? PP.topicsForPapers(syllabus, papers)?.filter(inYear) : null;
  if (byPapers?.length) return byPapers;
  return stageId === "as" ? syllabus.topics.filter((t) => t.stage !== "a2") : syllabus.topics.filter(inYear);
}

/**
 * A subject's chosen papers with their dates, and each topic's exam: the
 * earliest of the papers that examine it (null when none has a date).
 */
export function paperPlan(s, syllabus, list, now) {
  const papers = (s.papers || []).map((id) => PP.paperOf(syllabus?.code, id)).filter(Boolean).map((p) => ({ ...p, at: PP.paperDate(s, p.id) }));
  const examOf = {};
  for (const tp of list) {
    let best = null;
    for (const p of papers) if (p.at != null && p.at >= now - DAY / 2 && PP.paperTopics(syllabus, p).some((x) => x.id === tp.id) && (best == null || p.at < best)) best = p.at;
    examOf[tp.id] = best;
  }
  return { papers, examOf };
}

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const startOfDay = (ms) => new Date(ms).setHours(0, 0, 0, 0);
const nextDay = (ms) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + 1);
  return d.setHours(0, 0, 0, 0);
};

// The words a calendar exam may use for a subject: its name, its code and
// common short forms ("Maths" for Mathematics), each matched as a whole
// word, so "Physics test" is never a Computer Science ("cs") exam.
function examNames(subject) {
  const out = new Set([subject.name, subject.code].filter(Boolean).map((x) => String(x).toLowerCase()));
  for (const n of [...out]) {
    if (/\bmathematics\b/.test(n)) {
      out.add(n.replace(/\bmathematics\b/, "maths"));
      out.add(n.replace(/\bmathematics\b/, "math"));
    }
  }
  return [...out].filter((n) => n.length >= 3);
}
/** The times (ms, earliest first) of calendar exams naming a subject. */
function examDates(subject, events) {
  const alt = examNames(subject).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!alt) return [];
  const re = new RegExp(`(^|[^a-z0-9])(${alt})([^a-z0-9]|$)`);
  return (events || [])
    .filter((e) => e.kind === "exam" && re.test(String(e.title || "").toLowerCase()))
    .map((e) => Date.parse(e.starts_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}
const examFrom = (dates, now) => dates.find((at) => at >= now - DAY / 2) ?? null;

/** The next exam in a subject: an exam event naming it (as a whole word). */
export const nextExam = (subject, events, now) => examFrom(examDates(subject, events), now);

/** Padding on early time estimates: 1.5× with no data, 1× after five blocks. */
export const pad = (p) => 1 + 0.5 * Math.max(0, 1 - (p?.n || 0) / 5);

const untouched = (t) => t.n === 0 && t.covered === 0 && t.minutes === 0 && t.S == null;

/**
 * What a topic needs at time `at`, or null. `ctx` carries the subject's
 * level, aim, exam and whether its order allows new learning.
 */
export function need(t, ctx) {
  const { at, target, examAt, level, firstNew, own } = ctx;
  const days = examAt ? (examAt - at) / DAY : Infinity;
  if (examAt && sameDay(examAt, at)) return null; // the exam day: rest it (buildPlan also skips the subject)
  const exam = Number.isFinite(days) && days >= 0 ? 1 + 2 * Math.exp(-days / 21) : 1;
  const boost = (LEVEL_BOOST[level] || 1) * exam;
  if (own) return { kind: "practice", score: 0.5 * boost };
  const m = L.mastery(t);
  const gap = Math.max(0, target - m);
  const due = L.dueAt(t, { examAt, now: at });
  if (due != null && due <= at) {
    const R = L.recallNow(t, at);
    const score = (0.9 + Math.max(0, 0.9 - R) * 3) * boost;
    // Still weak: a short review only re-asks what isn't known yet, so it
    // becomes practice (or learning, if the topic isn't finished), with the
    // review's urgency. Close to the exam (2 days) a review is enough.
    if (gap > 0.25 && days > 2) return t.covered < 1 ? { kind: "learn", score } : { kind: "practice", score };
    return { kind: "review", score };
  }
  if (untouched(t)) return firstNew && days > 2 ? { kind: "check", score: (0.5 + (level <= 2 ? 0.3 : 0)) * boost } : null;
  if (t.covered < 1) return days > 2 ? { kind: "learn", score: (0.6 + gap) * boost } : null;
  if (gap > 0) return { kind: "practice", score: gap * 1.5 * boost };
  return null;
}

/** What a block would do to a topic, roughly, so later days plan on it. */
function simulate(t, kind, minutes, at, perTopic) {
  if (kind === "check") return { ...t, n: 1, covered: Math.max(t.covered, 0.3), last: at, S: 1, D: 5 };
  if (kind === "learn") {
    const covered = Math.min(1, t.covered + minutes / Math.max(1, perTopic));
    return covered >= 1 ? L.review({ ...t, covered }, 3, at) : { ...t, covered };
  }
  if (kind === "practice" || kind === "topical") return L.review({ ...t, theta: Math.min(4, t.theta + 0.35) }, 3, at);
  return L.review(t, 3, at);
}

/**
 * The plan for the days ahead.
 *
 * @param {object} o
 * @param {object} o.profile   fromRow() answers (subjects with levels, aim, stage, times)
 * @param {object} o.syllabi   { subjectId: syllabus json | null }
 * @param {object} o.topics    { subjectId: { topicId: learner state } }
 * @param {object} o.pace      { subjectId: { pace, n } }
 * @param {Array}  o.events    student_events (exams are read from it)
 * @param {number} o.doneToday focus minutes already done today
 * @param {number} o.now       ms
 * @param {number} [o.days]    how many days, from today (7)
 * @param {object} [o.papersDone] { subjectId: { paperId: ms } }: the last past paper of each
 */
export function buildPlan({ profile, syllabi = {}, topics = {}, pace = {}, events = [], doneToday = 0, now = Date.now(), days = 7, rules = null, papersDone = {} }) {
  const target = TARGET[profile.aim] || TARGET.good;
  const R = rules || R_.empty();
  const level = stageOf(profile.stage)?.level || "other";
  // A boarder's weekend: their answer for it, or their usual (capacity.js).
  const whereOf = (ms) => R_.awayOn(R, ms, profile.schoolDays || []);
  // How long they like to focus before a break (phase 39): a longer
  // stretch earns a longer break.
  const focus = cleanRoutine(profile.routine).focus;
  const pause = focus >= 50 ? 10 : BREAK;

  // Every subject's topics, with live (simulated) state.
  const subjects = (profile.subjects || []).map((s) => {
    const syllabus = syllabi[s.id] || null;
    const list = topicsInScope(syllabus, profile.stage, s.papers);
    const own = list[0].id === "*";
    const { papers, examOf } = paperPlan(s, syllabus, list, now);
    const perTopic = L.typicalMinutes(level, own ? 1 : list.length) * (pace[s.id]?.pace || 1) * pad(pace[s.id]);
    const state = {};
    for (const tp of list) state[tp.id] = topics[s.id]?.[tp.id] || L.newTopic(s.level ?? 2);
    const lastPaper = { ...(papersDone[s.id] || {}) };
    // The sittings of its papers: busy on the day, and the subject rests.
    const sittings = papers.filter((p) => p.at != null && PP.timedPaper(p)).map((p) => ({ at: p.at, minutes: p.minutes || 120 }));
    // Its last exam, when every chosen paper has a date: after that day,
    // the subject is done and isn't planned.
    const lastExam = papers.length && papers.every((p) => p.at != null) ? Math.max(...papers.map((p) => p.at)) : null;
    const name = (s.custom && s.name) || subjectName(profile.stage, s.id) || syllabus?.name || s.id;
    const exams = examDates({ name, code: syllabus?.code }, events);
    return { id: s.id, code: syllabus?.code, name, level: s.level ?? 2, list, own, perTopic, state, papers, examOf, lastPaper, sittings, lastExam, exams };
  });
  // Does subject `s` sit an exam (a paper, or a calendar exam naming it) in [a, b)?
  const examIn = (s, a, b) => [...s.sittings.map((x) => x.at), ...s.exams].some((at) => at >= a && at < b);
  // A topical set for one of a subject's topics, from the questions it has
  // done; worked out again only once that changes.
  const sets = new Map();
  const setFor = (s, tp) => {
    if (s.own) return null;
    const { asked } = s.state[tp.id];
    const hit = sets.get(`${s.id}/${tp.id}`);
    if (hit?.asked === asked) return hit.set;
    const set = topicalSet(tp, { code: s.code, papers: s.papers.map((p) => p.id), asked });
    sets.set(`${s.id}/${tp.id}`, { asked, set });
    return set;
  };

  const out = [];
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  for (let d = 0; d < days; d++) {
    const date = new Date(midnight);
    date.setDate(midnight.getDate() + d);
    const cap = dateCapacity(profile, date.getTime(), whereOf);
    // The student's own changes (rules.js): a day off, a cap, a later start.
    const own = R_.dayRule(R, date.getTime());
    let from = Math.max(cap.from, own.from);
    // What's already taken (sport, coaching, a function on the calendar):
    // it comes off the day, and no block goes over it. Between a boarder's
    // study times counts as taken too (ending a break early, so the next
    // time starts on the minute).
    const busy = busyOf(profile, events, date.getTime());
    const t0 = date.getTime();
    const t1 = nextDay(t0);
    const t2 = nextDay(t1);
    const yesterday = startOfDay(t0 - DAY / 2);
    // A paper sat today is busy from half an hour before to half an hour
    // after, and nothing is planned on the morning before it: study that
    // day starts once the last sitting is over.
    let afterExams = 0;
    for (const s of subjects) for (const x of s.sittings) if (x.at >= t0 && x.at < t1) {
      const a = Math.round((x.at - t0) / 60000);
      busy.push([a - 30, a + x.minutes + 30]);
      afterExams = Math.max(afterExams, a + x.minutes + 30);
    }
    const examToday = new Set(subjects.filter((s) => examIn(s, t0, t1)).map((s) => s.id));
    const examTomorrow = new Set(subjects.filter((s) => examIn(s, t1, t2)).map((s) => s.id));
    const nearExam = new Set(subjects.filter((s) => examIn(s, yesterday, t2)).map((s) => s.id));
    const finished = new Set(subjects.filter((s) => s.lastExam != null && s.lastExam < t0).map((s) => s.id));
    for (let w = 1; w < (cap.windows?.length || 0); w++) busy.push([cap.windows[w - 1][1], cap.windows[w][0] - BREAK]);
    from = Math.max(from, afterExams);
    const free = (a) => Math.max(0, cap.to - a - busyWithin(busy, a, cap.to));
    // The student's own crash day or cap can go past the usual plan, but
    // never past a humane ceiling: the usual cap plus an hour on a school
    // day, the weekend cap otherwise (capacity.js caps).
    const ceiling = Math.min(CRASH, cap.school ? caps(stageOf(profile.stage)?.grade).school + 60 : caps(stageOf(profile.stage)?.grade).free);
    let room = own.off ? 0 : own.crash ? Math.min(ceiling, free(from)) : own.cap != null ? Math.min(own.cap, ceiling, free(from)) : Math.min(cap.planned, free(from));
    if (d === 0) {
      const nowMin = Math.ceil((now - date.getTime()) / 60000 / 5) * 5;
      from = Math.max(from, nowMin);
      room = Math.max(0, Math.min(room - doneToday, free(from)));
    }
    const at = date.getTime() + Math.max(from, minutesOf("12:00")) * 60000; // a moment in the study window
    const day = { date: date.getTime(), weekday: date.getDay(), light: cap.light, school: cap.school, planned: cap.planned, from, to: cap.to, off: own.off, crash: !own.off && own.crash, capped: own.cap != null, busy: cap.windows ? 0 : busyWithin(busy, from, cap.to), prep: !!cap.prep, where: cap.where || null, travel: cap.travel || 0, life: cap.life || [], blocks: [] };
    const perSubject = new Map(); // minutes
    const blocksOf = new Map();
    const checksOf = new Map();
    const usedTopics = new Set();
    const maxPerSubject = subjects.length > 1 ? Math.max(50, room * (own.crash ? 0.6 : 0.5)) : Infinity;
    let start = from;
    let sinceBreak = 0;
    // The first start at or after `start` where `minutes` fit before the
    // day ends without crossing anything already taken; null if none.
    const slot = (minutes) => {
      let t = start;
      for (let guard = 0; guard < 20; guard++) {
        const hit = busy.find(([a, b]) => a < t + minutes && b > t);
        if (!hit) return t + minutes <= cap.to ? t : null;
        t = Math.ceil((hit[1] + BREAK) / 5) * 5;
      }
      return null;
    };
    const place = (s, tp, kind, minutes, set = null) => {
      start = slot(minutes) ?? start;
      const what = set ? { paper: set.paper, qs: set.keys, count: set.count, marks: set.marks } : tp.paper ? { paper: tp.paper } : {};
      day.blocks.push({ kind, subject: s.id, subjectName: s.name, topic: tp.id, topicName: tp.name, chapter: chapterOf(tp.id), minutes, start, own: s.own, ...what });
      if (kind === "paper") s.lastPaper[tp.paper] = at;
      else s.state[tp.id] = simulate(s.state[tp.id], kind, minutes, at, s.perTopic);
      // A planned set counts as done, so the next one moves on.
      if (set) s.state[tp.id] = { ...s.state[tp.id], asked: L.noteAsked(s.state[tp.id].asked, set.ids, at) };
      perSubject.set(s.id, (perSubject.get(s.id) || 0) + minutes);
      blocksOf.set(s.id, (blocksOf.get(s.id) || 0) + 1);
      if (kind === "check") checksOf.set(s.id, (checksOf.get(s.id) || 0) + 1);
      usedTopics.add(`${s.id}/${tp.id}`);
      sinceBreak += minutes;
      const rest = sinceBreak >= focus ? pause : 0;
      if (rest) sinceBreak = 0;
      room -= minutes + rest;
      start += minutes + rest;
    };
    // Blocks the student pulled into this day go first.
    for (const pin of R.pins.filter((p) => p.date === own.key)) {
      const s = subjects.find((x) => x.id === pin.subject);
      const tp = s?.list.find((x) => x.id === pin.topic);
      const set = s && tp && pin.kind === "topical" ? setFor(s, tp) : null;
      const minutes = set ? set.minutes : KINDS[pin.kind]?.minutes;
      if (!s || !tp || !minutes || minutes > room || slot(minutes) == null || examToday.has(s.id) || finished.has(s.id)) continue;
      place(s, tp, pin.kind, minutes, set);
      day.blocks[day.blocks.length - 1].pinned = true;
    }
    const skipped = new Set(R.skips.filter((k) => k.startsWith(own.key)).map((k) => k.slice(11)));

    while (room >= 10) {
      let best = null;
      const papersToday = day.blocks.filter((b) => b.kind === "paper").length;
      for (const s of subjects) {
        const weight = R.weight[s.id] ?? 1;
        // Its exam day rests it, and after its last exam it's done.
        if (!weight || examToday.has(s.id) || finished.has(s.id) || skipped.has(`${s.id}|*`)) continue;
        const used = perSubject.get(s.id) || 0;
        const count = blocksOf.get(s.id) || 0;
        const checks = checksOf.get(s.id) || 0;
        const calendarExam = examFrom(s.exams, t0);
        const examFor = (tp) => Math.min(calendarExam ?? Infinity, s.examOf[tp.id] ?? Infinity);
        // A timed past paper of each chosen paper, as its date nears.
        for (const p of s.papers) {
          // No timed past paper the day before, of, or after a real one.
          if (p.at == null || !PP.timedPaper(p) || nearExam.has(s.id) || papersToday >= (own.crash ? 2 : 1) || skipped.has(`${s.id}|paper-${p.id}`)) continue;
          const left = (p.at - date.getTime()) / DAY;
          if (left < 1 || left > PAPER_WINDOW) continue;
          const last = s.lastPaper[p.id];
          if (last != null && (at - last) / DAY < paperGap(left)) continue;
          const minutes = Math.min(180, Math.ceil(((p.minutes || 90) + 15) / 5) * 5);
          const tp = { id: `paper-${p.id}`, name: PP.paperLabel(p), paper: p.id };
          if (usedTopics.has(`${s.id}/${tp.id}`) || minutes > room || used + minutes > Math.max(maxPerSubject, minutes) * Math.max(1, weight) || slot(minutes) == null) continue;
          const score = (1.3 + 2 * Math.exp(-left / 14)) * weight * Math.pow(0.75, count);
          if (!best || score > best.score) best = { kind: "paper", score, s, tp, minutes };
        }
        // Only the first new topic in syllabus order is offered at a time.
        const firstNewId = s.list.find((tp) => untouched(s.state[tp.id]) && !usedTopics.has(`${s.id}/${tp.id}`))?.id;
        for (const tp of s.list) {
          const key = `${s.id}/${tp.id}`;
          if (usedTopics.has(key) || skipped.has(`${s.id}|${tp.id}`)) continue;
          const exam = examFor(tp);
          let n = need(s.state[tp.id], { at, target, examAt: Number.isFinite(exam) ? exam : null, level: s.level, firstNew: tp.id === firstNewId, own: s.own });
          if (!n || (n.kind === "check" && checks >= 3)) continue;
          // Practice on a chapter that's half known, or near its exam, is a timed topical set.
          if (n.kind === "practice" && preferTopical(s.state[tp.id], (exam - at) / DAY)) {
            const set = setFor(s, tp);
            if (set) n = { ...n, kind: "topical", set };
          }
          // The evening before its exam: a light review at most (two blocks).
          if (examTomorrow.has(s.id) && (n.kind !== "review" || count >= 2)) continue;
          const minutes = n.set ? n.set.minutes : KINDS[n.kind].minutes;
          if (minutes > room || used + minutes > maxPerSubject * Math.max(1, weight) || slot(minutes) == null) continue;
          const score = n.score * weight * Math.pow(0.75, count);
          if (!best || score > best.score) best = { ...n, score, s, tp, minutes };
        }
      }
      if (!best) break;
      place(best.s, best.tp, best.kind, best.minutes, best.set);
    }
    day.minutes = day.blocks.reduce((n, b) => n + b.minutes, 0);
    out.push(day);
  }
  return out;
}

/** The next block: the first one left today, or null. */
export const nextBlock = (plan) => plan[0]?.blocks[0] || null;

/**
 * A topic's state after a finished block and its check.
 *   answers  [{ correct, options }] from the check (may be empty)
 *   covered  for a learn block, the share of the topic now done (0..1)
 *   rating   for "own work" blocks with no questions: 1..4 (how it went)
 */
export function afterBlock(t, { kind, answers = [], covered = null, rating = null, minutes = 0, now = Date.now() }) {
  let next = { ...t, minutes: Math.min(100000, (t.minutes || 0) + Math.max(0, Math.round(minutes))) };
  for (const a of answers) next = L.answer(next, { correct: !!a.correct, options: a.options || 4, difficulty: Number(a.d) || 0, repeat: !!a.repeat, now });
  if (answers.some((a) => a.id)) next.asked = L.noteAsked(t.asked, answers.filter((a) => a.id).map((a) => a.id), now);
  const score = answers.length ? answers.filter((a) => a.correct).length / answers.length : null;
  if (kind === "check") {
    next.covered = score != null && score >= 0.67 ? 1 : Math.max(next.covered, 0);
  } else if (kind === "learn" && covered != null) {
    next.covered = Math.min(1, Math.max(next.covered, covered));
  }
  // All right, but only on questions seen lately: Good, not Easy.
  const allRepeats = answers.length && answers.every((a) => a.repeat);
  const grade = score != null ? Math.min(L.gradeOf(score), allRepeats ? 3 : 4) : rating;
  // The memory clock starts once the topic has been met properly: a check
  // that showed it is known, any later block on it, or own-work blocks.
  if (grade && (kind !== "learn" || next.covered >= 1) && !(kind === "check" && next.covered < 1)) next = L.review(next, grade, now);
  return next;
}

/** A test mark (0..1) applied to the topics it covered. */
export function applyResult(states, fraction, topicIds) {
  const out = { ...states };
  for (const id of topicIds) if (out[id]) out[id] = L.applyMark(out[id], fraction);
  return out;
}

/** A subject's readiness: mean mastery over its topics (untouched count at their start). */
export function readiness(list, states, level = 2) {
  if (!list.length) return 0;
  return list.reduce((n, tp) => n + L.mastery(states?.[tp.id] || L.newTopic(level)), 0) / list.length;
}
