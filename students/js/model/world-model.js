// Your world, as numbers.
//
// The globe is not decoration: every visible feature is computed here from
// studying you actually did (phase 37: only studying grows it), and the
// World page prints the number next to the feature it drives:
//
//   land        study hours, all time         focus sessions and exam-style questions; never shrinks
//   lights      tasks completed, all time     one light per task, on the night side
//   forests     chapters covered              green spreads as the syllabus gets covered
//   glow        chapters known                the seas light up with what you know well
//   aurora      marks earned, last 30 days    exam-style questions and past papers
//   atmosphere  past papers, last 60 days     each timed paper thickens the air
//   ring        study days, last 7            appears at 5 study days of 7
//   moons       your goals                    each fills as the goal is met
//   clouds      time away, reviews due        mist over what's fading; clears when you review or return
//
// Nothing here punishes. Land and forests are cumulative, so a bad week
// cannot undo a good term; fading and time away show as weather, and
// weather passes.
//
// Pure (tests/students-model.test.mjs).
import { DAY, startOfDay, startOfWeek, dayKey, parseDayKey } from "./time.js";

const sat = (x, k) => 1 - Math.exp(-Math.max(0, x) / k);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export const LAND_BASE = 0.06;
export const LAND_MAX_GAIN = 0.4;
export const MAX_LIGHTS = 600;

function sumBy(rows, f) {
  let s = 0;
  for (const r of rows) s += f(r) || 0;
  return s;
}

function within(rows, field, since) {
  return rows.filter((r) => {
    const t = field === "occurred_on" ? parseDayKey(r[field]).getTime() : Date.parse(r[field]);
    return Number.isFinite(t) && t >= since;
  });
}

// Exam-style questions marked (phase 37): logs of kind "questions".
export const questionLogs = (logs) => logs.filter((l) => l.kind === "questions");
// Past papers: results titled "Paper N · …" (paper-sheets.js).
export const pastPapers = (results) => results.filter((r) => /^Paper \d{1,2} · /.test(r.title || ""));

// Every local day on which you studied: a focus session, a finished task,
// exam-style questions marked, or a result added. The world counts only
// these; the week's rhythm and the month's stars (which aren't the world)
// also count a day you closed, when given `entries`.
export function activeDays({ sessions = [], tasks = [], logs = [], results = [], entries = [] }) {
  const days = new Set();
  for (const s of sessions) if (s.focused_minutes > 0) days.add(dayKey(s.started_at));
  for (const t of tasks) if (t.done_at) days.add(dayKey(t.done_at));
  for (const l of questionLogs(logs)) days.add(l.occurred_on);
  for (const r of results) if (r.created_at) days.add(dayKey(r.created_at));
  for (const e of entries) if (e.closed_at) days.add(e.day);
  return days;
}

// Progress toward each goal. A weekly goal counts focus minutes since Monday
// (only for its subject, if it names one); a milestone is done or not.
export function goalProgress(goal, sessions, now) {
  if (goal.weekly_minutes) {
    const since = startOfWeek(now).getTime();
    const subject = (goal.subject || "").trim().toLowerCase();
    const minutes = sumBy(within(sessions, "started_at", since), (s) =>
      !subject || (s.subject || "").trim().toLowerCase() === subject ? s.focused_minutes : 0
    );
    return { minutes, value: clamp01(minutes / goal.weekly_minutes), done: minutes >= goal.weekly_minutes };
  }
  return { minutes: 0, value: goal.done_at ? 1 : 0, done: !!goal.done_at };
}

/**
 * @param {{sessions?: object[], tasks?: object[], logs?: object[], goals?: object[],
 *          results?: object[], knowledge?: {total: number, covered: number, known: number, due: number},
 *          bornAt?: string|null, now?: number}} input
 * `knowledge` counts the chapters in the student's syllabus scope: how many
 * there are, covered, known to their aim, and due for review (planner.js).
 */
export function buildWorld({ sessions = [], tasks = [], logs = [], goals = [], entries = [], results = [], knowledge = null, bornAt = null, now = Date.now() } = {}) {
  const today = startOfDay(now).getTime();
  const d30 = today - 29 * DAY;
  const week = startOfWeek(now).getTime();

  const focusMinutesTotal = sumBy(sessions, (s) => s.focused_minutes);
  const focusMinutesWeek = sumBy(within(sessions, "started_at", week), (s) => s.focused_minutes);
  const focusMinutesToday = sumBy(within(sessions, "started_at", today), (s) => s.focused_minutes);
  const done = tasks.filter((t) => t.done_at);
  const tasksDone = done.length;
  const tasksDoneWeek = within(done, "done_at", week).length;

  const questions = questionLogs(logs);
  const questionMinutes = sumBy(questions, (l) => l.minutes);
  const papers = pastPapers(results);
  // Marks earned in the last 30 days: questions, and past papers (as marks
  // on the same scale: a paper's percentage of 40).
  const marks30 = sumBy(within(questions, "occurred_on", d30), (l) => l.marks) + sumBy(within(papers, "taken_on", d30), (r) => (40 * Number(r.score)) / Math.max(1, Number(r.out_of)));
  const papers60 = within(papers, "taken_on", today - 59 * DAY).length;
  const k = knowledge && knowledge.total > 0 ? knowledge : null;
  const covered = k ? clamp01(k.covered / k.total) : 0;
  const known = k ? clamp01(k.known / k.total) : 0;
  const due = k && k.covered ? clamp01(k.due / k.covered) : 0;

  const days = activeDays({ sessions, tasks, logs, results });
  let active7 = 0;
  for (let i = 0; i < 7; i++) if (days.has(dayKey(today - i * DAY))) active7++;
  let lastActive = null;
  for (const k of days) {
    const t = parseDayKey(k).getTime();
    if (t <= today && (lastActive === null || t > lastActive)) lastActive = t;
  }
  const daysSinceActive = lastActive === null ? null : Math.round((today - lastActive) / DAY);
  const born = bornAt ? Date.parse(bornAt) : NaN;
  const ageDays = Number.isFinite(born) ? Math.max(0, Math.floor((now - born) / DAY)) : 0;

  const focusHours = (focusMinutesTotal + questionMinutes) / 60;
  const layers = {
    land: LAND_BASE + LAND_MAX_GAIN * sat(focusHours, 60),
    // The real Earth (js/earth.js): how much of its land has risen from the
    // sea -- none at first, a third after about thirty hours of focus, all
    // of it after a few hundred -- and how many of its city lights are on.
    earth: Math.min(1, 1.06 * sat(focusHours, 70)),
    cities: sat(tasksDone, 120),
    lights: Math.min(MAX_LIGHTS, tasksDone),
    aurora: sat(marks30, 120),
    forest: 0.12 + 0.78 * covered,
    glow: known,
    atmosphere: 0.15 + 0.85 * sat(papers60, 3),
    // A brand-new world has never been away: clear skies. Mist gathers over
    // chapters due for review, and clears as they're reviewed.
    clouds: Math.max(daysSinceActive === null ? 0.08 : 0.08 + 0.5 * clamp01(daysSinceActive / 14), 0.08 + 0.3 * due),
    ring: active7 >= 5 ? active7 / 7 : 0,
  };

  const moons = goals.map((g) => ({ id: g.id, title: g.title, ...goalProgress(g, sessions, now) }));

  return {
    layers,
    moons,
    stats: {
      focusMinutesTotal,
      focusMinutesWeek,
      focusMinutesToday,
      tasksDone,
      tasksDoneWeek,
      studyMinutesTotal: focusMinutesTotal + questionMinutes,
      questionsDone: questions.length,
      marks30: Math.round(marks30),
      papersDone: papers.length,
      papers60,
      chapters: k ? k.total : 0,
      covered: k ? k.covered : 0,
      known: k ? k.known : 0,
      due: k ? k.due : 0,
      active7,
      daysSinceActive,
      ageDays,
    },
    discoveries: discoveries({ sessions, tasks, logs, goals, entries, results, now }),
  };
}

// Milestones, each stamped with the moment it was actually reached --
// worked out from history, so they need no table of their own and can never
// disagree with it.
const FOCUS_MARKS = [
  [1, "First hour", "One hour of real focus. The first land rose from the sea, in the heart of India."],
  [10, "Ten hours", "Ten focused hours. The subcontinent stands above the sea."],
  [25, "Twenty-five hours", "A third of Earth's land, back from the sea. Coastlines you could name."],
  [50, "Fifty hours", "Half the world's land. This is what a habit looks like from orbit."],
  [100, "A hundred hours", "A hundred hours, and most of the Earth has risen. Most people never get here."],
  [250, "Two hundred and fifty hours", "The whole Earth, risen. A world that would take a lifetime to map."],
];
const TASK_MARKS = [
  [1, "First light", "You finished something. A city lit up on the night side."],
  [10, "A town", "Ten tasks done. The great cities are glowing."],
  [50, "A city", "Fifty finished things. Whole coastlines glow in the dark."],
  [200, "A network", "Two hundred. The night side is mapped in light, town by town."],
];

const PAGE_MARKS = [
  [1, "First page", "You closed a day. Your world keeps its pages."],
  [7, "A week of pages", "Seven days written down. Look back at them sometime."],
  [30, "Thirty pages", "A month of days, kept. That's a journal."],
  [100, "A hundred pages", "A hundred days remembered. Most of a school year, in your own words."],
];

export function discoveries({ sessions = [], tasks = [], logs = [], goals = [], entries = [], results = [], now = Date.now() }) {
  const out = [];
  const byTime = sessions
    .filter((s) => s.focused_minutes > 0)
    .slice()
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  if (byTime.length) out.push({ id: "first-focus", title: "First session", detail: "The first time you sat down and focused here.", at: byTime[0].started_at });
  let acc = 0;
  let mark = 0;
  for (const s of byTime) {
    acc += s.focused_minutes;
    while (mark < FOCUS_MARKS.length && acc >= FOCUS_MARKS[mark][0] * 60) {
      const [, title, detail] = FOCUS_MARKS[mark];
      out.push({ id: `focus-${FOCUS_MARKS[mark][0]}`, title, detail, at: s.ended_at || s.started_at });
      mark++;
    }
  }

  const done = tasks.filter((t) => t.done_at).sort((a, b) => Date.parse(a.done_at) - Date.parse(b.done_at));
  for (const [n, title, detail] of TASK_MARKS) {
    if (done.length >= n) out.push({ id: `tasks-${n}`, title, detail, at: done[n - 1].done_at });
  }

  const marked = questionLogs(logs).sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : 1));
  if (marked.length) out.push({ id: "first-aurora", title: "First aurora", detail: "Your first exam-style question, marked. The poles lit up.", at: parseDayKey(marked[0].occurred_on).toISOString() });
  const papers = pastPapers(results).sort((a, b) => (a.taken_on < b.taken_on ? -1 : 1));
  if (papers.length) out.push({ id: "first-paper", title: "First past paper", detail: "A whole paper, marked. The air around your world thickened.", at: parseDayKey(papers[0].taken_on).toISOString() });

  // Seven days in a row, any time in history.
  const days = [...activeDays({ sessions, tasks, logs, results })].sort();
  let run = 0;
  let prev = null;
  for (const k of days) {
    const t = parseDayKey(k).getTime();
    run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    prev = t;
    if (run === 7) {
      out.push({ id: "streak-7", title: "A ring", detail: "Seven study days in a row. A ring formed around your world.", at: new Date(t).toISOString() });
      break;
    }
  }

  // Closed days: the journal's pages.
  const pages = entries.filter((e) => e.closed_at).sort((a, b) => (a.day < b.day ? -1 : 1));
  for (const [n, title, detail] of PAGE_MARKS) {
    if (pages.length >= n) out.push({ id: `pages-${n}`, title, detail, at: pages[n - 1].closed_at });
  }

  const moon = goals.filter((g) => g.done_at).sort((a, b) => Date.parse(a.done_at) - Date.parse(b.done_at))[0];
  if (moon) out.push({ id: "first-moon", title: "A moon, completed", detail: `“${moon.title}” — done.`, at: moon.done_at });

  return out.filter((d) => Date.parse(d.at) <= now + DAY).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// One sentence about the weather, for the World page.
export function weatherLine(stats) {
  const d = stats.daysSinceActive;
  if (d === null) return "Clear skies. Nothing has happened here yet — that's what a new world looks like.";
  if (stats.due && d !== null && d < 1) return `A little mist over ${stats.due} chapter${stats.due > 1 ? "s" : ""} due for review. It clears as you review them.`;
  if (d === 0) return "Clear skies. You studied today.";
  if (d === 1) return "A few clouds. You were here yesterday.";
  if (d < 7) return `Clouds have drifted in over ${d} days. They clear the moment you do anything here.`;
  return "Overcast. Your world kept everything you built — it's just waiting under the clouds.";
}
