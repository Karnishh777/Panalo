// Your world, as numbers.
//
// The globe is not decoration: every visible feature is computed here from
// something you actually did, and the World page prints the number next to
// the feature it drives. The mapping is deliberately simple enough to state
// in one sentence each:
//
//   land        focus hours, all time         grows, never shrinks
//   lights      tasks completed, all time     one light per task, on the night side
//   aurora      making things, last 30 days   art, music, writing, code you logged
//   forests     moving and resting, 30 days   how much of the land is green
//   glow        reading, last 30 days         the oceans light up
//   atmosphere  people, last 7 days           messages you sent + time logged with people
//   ring        showing up, last 7 days       appears at 5 active days of 7
//   moons       your goals                    each fills as the goal is met
//   clouds      time away                     gather while you're gone, clear the day you return
//
// Nothing here punishes. Land is cumulative, so a bad week cannot undo a
// good term; time away shows as weather, and weather passes.
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

// Every local day on which you did something that counts: a focus session,
// a finished task, a logged activity, or a day you closed (phase 24).
export function activeDays({ sessions = [], tasks = [], logs = [], entries = [] }) {
  const days = new Set();
  for (const s of sessions) if (s.focused_minutes > 0) days.add(dayKey(s.started_at));
  for (const t of tasks) if (t.done_at) days.add(dayKey(t.done_at));
  for (const l of logs) days.add(l.occurred_on);
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
 *          sentMessages?: object[], bornAt?: string|null, now?: number}} input
 */
export function buildWorld({ sessions = [], tasks = [], logs = [], goals = [], sentMessages = [], entries = [], bornAt = null, now = Date.now() } = {}) {
  const today = startOfDay(now).getTime();
  const d7 = today - 6 * DAY;
  const d30 = today - 29 * DAY;
  const week = startOfWeek(now).getTime();

  const focusMinutesTotal = sumBy(sessions, (s) => s.focused_minutes);
  const focusMinutesWeek = sumBy(within(sessions, "started_at", week), (s) => s.focused_minutes);
  const focusMinutesToday = sumBy(within(sessions, "started_at", today), (s) => s.focused_minutes);
  const done = tasks.filter((t) => t.done_at);
  const tasksDone = done.length;
  const tasksDoneWeek = within(done, "done_at", week).length;

  const logs30 = within(logs, "occurred_on", d30);
  const logs7 = within(logs, "occurred_on", d7);
  const minutesOf = (rows, kinds) => sumBy(rows, (l) => (kinds.includes(l.kind) ? l.minutes : 0));
  const createMinutes30 = minutesOf(logs30, ["create"]);
  const bodyMinutes30 = minutesOf(logs30, ["move", "rest"]);
  const readMinutes30 = minutesOf(logs30, ["read"]);
  const connectMinutes7 = minutesOf(logs7, ["connect"]);
  const messages7 = within(sentMessages, "created_at", d7).length;

  const days = activeDays({ sessions, tasks, logs, entries });
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

  const focusHours = focusMinutesTotal / 60;
  const layers = {
    land: LAND_BASE + LAND_MAX_GAIN * sat(focusHours, 60),
    lights: Math.min(MAX_LIGHTS, tasksDone),
    aurora: sat(createMinutes30, 300),
    forest: 0.12 + 0.78 * sat(bodyMinutes30, 600),
    glow: sat(readMinutes30, 300),
    atmosphere: 0.15 + 0.85 * sat(messages7 + connectMinutes7 / 10, 40),
    // A brand-new world has never been away: clear skies.
    clouds: daysSinceActive === null ? 0.08 : 0.08 + 0.5 * clamp01(daysSinceActive / 14),
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
      createMinutes30,
      bodyMinutes30,
      readMinutes30,
      connectMinutes7,
      messages7,
      active7,
      daysSinceActive,
      ageDays,
    },
    discoveries: discoveries({ sessions, tasks, logs, goals, entries, now }),
  };
}

// Milestones, each stamped with the moment it was actually reached --
// worked out from history, so they need no table of their own and can never
// disagree with it.
const FOCUS_MARKS = [
  [1, "First hour", "One hour of real focus. The first land rose from the sea."],
  [10, "Ten hours", "Ten focused hours. Your first continent."],
  [25, "Twenty-five hours", "A coastline long enough to name."],
  [50, "Fifty hours", "Mountains. This is what a habit looks like from orbit."],
  [100, "A hundred hours", "A hundred hours. Most people never get here."],
  [250, "Two hundred and fifty hours", "A world that would take a lifetime to map."],
];
const TASK_MARKS = [
  [1, "First light", "You finished something. A light came on on the night side."],
  [10, "A town", "Ten tasks done. The lights have started to cluster."],
  [50, "A city", "Fifty finished things, glowing in the dark."],
  [200, "A network", "Two hundred. The night side is mapped in light."],
];

const PAGE_MARKS = [
  [1, "First page", "You closed a day. Your world keeps its pages."],
  [7, "A week of pages", "Seven days written down. Look back at them sometime."],
  [30, "Thirty pages", "A month of days, kept. That's a journal."],
  [100, "A hundred pages", "A hundred days remembered. Most of a school year, in your own words."],
];

export function discoveries({ sessions = [], tasks = [], logs = [], goals = [], entries = [], now = Date.now() }) {
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

  const created = logs.filter((l) => l.kind === "create").sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : 1));
  if (created.length) out.push({ id: "first-aurora", title: "First aurora", detail: "You made something. The poles lit up.", at: parseDayKey(created[0].occurred_on).toISOString() });

  // Seven days in a row, any time in history.
  const days = [...activeDays({ sessions, tasks, logs, entries })].sort();
  let run = 0;
  let prev = null;
  for (const k of days) {
    const t = parseDayKey(k).getTime();
    run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    prev = t;
    if (run === 7) {
      out.push({ id: "streak-7", title: "A ring", detail: "Seven days in a row. A ring formed around your world.", at: new Date(t).toISOString() });
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
  if (d === 0) return "Clear skies. You showed up today.";
  if (d === 1) return "A few clouds. You were here yesterday.";
  if (d < 7) return `Clouds have drifted in over ${d} days. They clear the moment you do anything here.`;
  return "Overcast. Your world kept everything you built — it's just waiting under the clouds.";
}
