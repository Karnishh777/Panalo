// Panalo Students: the pure models behind the world, the calendar, the
// Study Room timer and Drift. Run with `node tests/students-model.test.mjs`.
import { buildWorld, discoveries, goalProgress, weatherLine, LAND_BASE } from "../students/js/model/world-model.js";
import { occurrencesBetween, occurrencesOnDay, arcOnDay, nextUp, tasksAsDeadlines } from "../students/js/model/timeline.js";
import * as T from "../students/js/model/focus-timer.js";
import { pickDrift, dayNumber } from "../students/js/model/drift-pick.js";
import { LIBRARY } from "../students/js/model/drift-library.js";
import { safeBlobType } from "../students/js/model/safe-type.js";
import * as D from "../students/js/model/daily.js";
import * as C from "../students/js/model/chronicle.js";
import { relTime, formatMinutes, startOfWeek, dayKey, parseDayKey, MINUTE, HOUR, DAY } from "../students/js/model/time.js";

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));

// A fixed local "now": Wednesday 1 October 2026, 10:00.
const NOW = new Date(2026, 9, 1, 10, 0, 0).getTime();
const at = (daysAgo, h = 9, m = 0) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const session = (daysAgo, minutes, subject = null) => ({
  started_at: at(daysAgo, 8),
  ended_at: new Date(Date.parse(at(daysAgo, 8)) + minutes * MINUTE).toISOString(),
  focused_minutes: minutes,
  subject,
});

// ---- time ------------------------------------------------------------------
ok("relTime future", relTime(NOW + 40 * MINUTE, NOW) === "in 40 min", relTime(NOW + 40 * MINUTE, NOW));
ok("relTime hours", relTime(NOW + 125 * MINUTE, NOW) === "in 2 h 5 min");
ok("relTime past", relTime(NOW - 12 * MINUTE, NOW) === "12 min ago");
ok("relTime now", relTime(NOW + 20000, NOW) === "now");
ok("formatMinutes", formatMinutes(95) === "1 h 35 min" && formatMinutes(40) === "40 min" && formatMinutes(120) === "2 h");
ok("weeks start on Monday", startOfWeek(NOW).getDay() === 1 && startOfWeek(NOW).getDate() === 28);
ok("dayKey round-trips as a local day", dayKey(parseDayKey("2026-03-09")) === "2026-03-09");

// ---- world -----------------------------------------------------------------
const empty = buildWorld({ now: NOW });
ok("a new world has a little land and nothing else", empty.layers.land === LAND_BASE && empty.layers.lights === 0 && empty.layers.ring === 0);
ok("a new world has clear skies", empty.layers.clouds < 0.1 && empty.stats.daysSinceActive === null);
ok("a new world has no discoveries", empty.discoveries.length === 0);

const tenHours = buildWorld({ sessions: Array.from({ length: 12 }, (_, i) => session(i, 50)), now: NOW });
ok("focus grows land", tenHours.layers.land > LAND_BASE + 0.05, tenHours.layers.land);
const lots = buildWorld({ sessions: Array.from({ length: 400 }, (_, i) => session(i % 300, 90)), now: NOW });
ok("land is bounded", lots.layers.land < 0.47 && lots.layers.land > tenHours.layers.land);

const tasks = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: "x", done_at: at(i % 3, 12) }));
tasks.push({ id: "open", title: "open", done_at: null });
const withTasks = buildWorld({ tasks, now: NOW });
ok("one light per finished task", withTasks.layers.lights === 12, withTasks.layers.lights);
ok("lights and land are independent", withTasks.layers.land === LAND_BASE);

const creative = buildWorld({ logs: [{ kind: "create", minutes: 120, occurred_on: dayKey(at(2)) }], now: NOW });
const oldCreative = buildWorld({ logs: [{ kind: "create", minutes: 120, occurred_on: dayKey(at(45)) }], now: NOW });
ok("making things lights the aurora", creative.layers.aurora > 0.2);
ok("the aurora reflects the last 30 days", oldCreative.layers.aurora === 0);
const body = buildWorld({ logs: [{ kind: "move", minutes: 300, occurred_on: dayKey(at(1)) }], now: NOW });
ok("moving and resting greens the land", body.layers.forest > empty.layers.forest);
const reading = buildWorld({ logs: [{ kind: "read", minutes: 200, occurred_on: dayKey(at(1)) }], now: NOW });
ok("reading lights the oceans", reading.layers.glow > 0.4 && empty.layers.glow === 0);
const social = buildWorld({ sentMessages: Array.from({ length: 30 }, () => ({ created_at: at(1) })), now: NOW });
ok("talking to people thickens the atmosphere", social.layers.atmosphere > empty.layers.atmosphere + 0.3);

const streak = buildWorld({ sessions: [0, 1, 2, 3, 4].map((d) => session(d, 30)), now: NOW });
ok("five active days of seven make a ring", streak.layers.ring > 0.7 && streak.stats.active7 === 5);
const four = buildWorld({ sessions: [0, 1, 2, 3].map((d) => session(d, 30)), now: NOW });
ok("four do not", four.layers.ring === 0);

const away = buildWorld({ sessions: [session(10, 30)], now: NOW });
const back = buildWorld({ sessions: [session(10, 30), session(0, 5)], now: NOW });
ok("time away gathers clouds", away.layers.clouds > 0.35 && away.stats.daysSinceActive === 10);
ok("coming back clears them the same day", back.layers.clouds < 0.1);
ok("time away never removes land", away.layers.land === buildWorld({ sessions: [session(0, 30)], now: NOW }).layers.land);
ok("weather never scolds", !/fail|lazy|lost|behind/i.test(weatherLine(away.stats) + weatherLine(back.stats)));

const goal = { id: "g", title: "Physics", weekly_minutes: 120, subject: "Physics" };
const prog = goalProgress(goal, [session(0, 60, "physics"), session(1, 30, "Maths"), session(5, 90, "Physics")], NOW);
ok("weekly goals count this week's matching focus only", prog.minutes === 60 && prog.value === 0.5, JSON.stringify(prog));
ok("milestones are done or not", goalProgress({ title: "m", done_at: at(1) }, [], NOW).value === 1);

const hist = discoveries({ sessions: Array.from({ length: 30 }, (_, i) => session(29 - i, 25)), tasks, now: NOW });
const ids = hist.map((d) => d.id);
ok("milestones are found in history", ["first-focus", "focus-1", "focus-10", "tasks-1", "tasks-10", "streak-7"].every((x) => ids.includes(x)), ids.join(","));
ok("each milestone carries when it happened", hist.every((d) => Number.isFinite(Date.parse(d.at))));
const tenth = hist.find((d) => d.id === "focus-10");
ok("ten hours is stamped at the session that crossed it", tenth && tenth.at === new Date(Date.parse(at(6, 8)) + 25 * MINUTE).toISOString(), tenth?.at);

// ---- timeline --------------------------------------------------------------
const physics = { id: "p", title: "Physics", kind: "class", starts_at: at(14, 11), ends_at: at(14, 12), repeat_weekly: true };
const essay = { id: "e", title: "Essay due", kind: "deadline", starts_at: at(-2, 23, 59), ends_at: null, repeat_weekly: false };
const week = occurrencesBetween([physics, essay], startOfWeek(NOW), new Date(startOfWeek(NOW).getTime() + 7 * DAY));
ok("a weekly class appears once a week", week.filter((o) => o.event.id === "p").length === 1, week.length);
ok("it keeps its weekday and time", week[0].start.getDay() === new Date(physics.starts_at).getDay() && week[0].start.getHours() === 11);
ok("a deadline appears once", week.filter((o) => o.event.id === "e").length === 1);
const before = occurrencesBetween([physics], new Date(Date.parse(physics.starts_at) - 30 * DAY), new Date(Date.parse(physics.starts_at) - DAY));
ok("a timetable slot does not repeat backwards", before.length === 0);
const today = occurrencesOnDay([{ ...physics, starts_at: at(7, 11), ends_at: at(7, 12, 30) }], NOW);
ok("today's occurrences", today.length === 1);
const arc = arcOnDay(today[0], NOW);
ok("arcs are fractions of the day", Math.abs(arc.a0 - 11 / 24) < 1e-9 && Math.abs(arc.a1 - 12.5 / 24) < 1e-9, JSON.stringify(arc));
const late = { id: "l", title: "Night", kind: "event", starts_at: at(0, 23), ends_at: at(-1, 2), repeat_weekly: false };
const lateArc = arcOnDay(occurrencesOnDay([late], NOW)[0], NOW);
ok("an arc that runs past midnight is clipped to the day", lateArc.a1 === 1);
const nu = nextUp([{ ...physics, starts_at: at(7, 10, 40), ends_at: at(7, 11, 30) }, { ...physics, id: "q", starts_at: at(7, 9, 30), ends_at: at(7, 10, 30) }], NOW);
ok("nextUp sees what is happening now and what is next", nu.current?.event.id === "q" && nu.next?.event.id === "p");
const dl = tasksAsDeadlines([{ id: "a", title: "A", due_at: at(-1) }, { id: "b", title: "B", due_at: at(-1), done_at: at(0) }, { id: "c", title: "C" }]);
ok("only open tasks with a due date become deadlines", dl.length === 1 && dl[0].kind === "deadline");

// ---- focus timer -----------------------------------------------------------
let s = T.start("focus", 25, NOW, { subject: "Maths" });
ok("a fresh timer has the full time", T.remaining(s, NOW) === 25 * MINUTE);
s = T.pause(s, NOW + 10 * MINUTE);
ok("pausing freezes the clock", T.remaining(s, NOW + 60 * MINUTE) === 15 * MINUTE);
s = T.resume(s, NOW + 60 * MINUTE);
ok("resuming continues from where it stopped", T.remaining(s, NOW + 65 * MINUTE) === 10 * MINUTE);
ok("paused time is not focus", T.focusedMinutes(s, NOW + 65 * MINUTE) === 15);
ok("it finishes", T.isDone(s, NOW + 80 * MINUTE) && T.remaining(s, NOW + 999 * MINUTE) === 0);
const row = T.sessionRow(s, NOW + 80 * MINUTE);
ok("a finished block records 25 minutes, completed", row.focused_minutes === 25 && row.completed && row.subject === "Maths");
ok("the stored session is plausible (focus <= wall time)",
   row.focused_minutes <= Math.ceil((Date.parse(row.ended_at) - Date.parse(row.started_at)) / MINUTE) + 1);
ok("under a minute is not worth recording", T.sessionRow(T.start("focus", 25, NOW), NOW + 30000) === null);
ok("rest is never recorded as focus", T.sessionRow(T.start("rest", 5, NOW), NOW + 5 * MINUTE) === null);
ok("readout", T.readout(25 * MINUTE) === "25:00" && T.readout(61000) === "01:01");
ok("revive refuses junk", T.revive({ phase: "focus", status: "running" }).phase === "idle" && T.revive(null).phase === "idle");
ok("revive keeps a real state", T.revive(JSON.parse(JSON.stringify(s))).plannedMs === 25 * MINUTE);

// ---- drift -----------------------------------------------------------------
const d1 = pickDrift(NOW, ["space"], LIBRARY);
const d1b = pickDrift(NOW + 3 * HOUR, ["space"], LIBRARY);
const d2 = pickDrift(NOW + DAY, ["space"], LIBRARY);
ok("the same three all day", d1.fact.id === d1b.fact.id && d1.prompt.id === d1b.prompt.id && d1.play.id === d1b.play.id);
ok("new ones tomorrow", d1.fact.id !== d2.fact.id);
ok("interests steer the facts", d1.fact.tags.includes("space"));
ok("no interests still gets something", !!pickDrift(NOW, [], LIBRARY).fact);
ok("day numbers advance by one", dayNumber(NOW + DAY) - dayNumber(NOW) === 1);
ok("library ids are unique", new Set([...LIBRARY.facts, ...LIBRARY.prompts].map((x) => x.id)).size === LIBRARY.facts.length + LIBRARY.prompts.length);

// ---- archive blob types (a security boundary) -----------------------------------
const T_ = (mime_type, file_name) => safeBlobType({ mime_type, file_name });
ok("an HTML page labelled as a PDF becomes a PDF, not a page", T_("text/html", "notes.pdf") === "application/pdf");
ok("HTML is never HTML", T_("text/html", "page.html") === "text/plain;charset=utf-8");
ok("SVG is never rendered as SVG", T_("image/svg+xml", "logo.svg") === "application/octet-stream");
ok("XHTML disguised as an image is opaque", T_("application/xhtml+xml", "cat.png") === "application/octet-stream");
ok("a real photo keeps its type", T_("image/jpeg", "a.jpg") === "image/jpeg");
ok("audio and video keep theirs", T_("audio/mpeg", "a.mp3") === "audio/mpeg" && T_("video/mp4", "a.mp4") === "video/mp4");
ok("plain text is plain", T_("", "notes.md") === "text/plain;charset=utf-8");
ok("anything else is just bytes", T_("application/zip", "a.zip") === "application/octet-stream" && T_("", "") === "application/octet-stream");

// ---- the daily ritual (phase 24) ----------------------------------------------
{
  const key = (daysAgo) => dayKey(new Date(Date.parse(at(daysAgo))));
  const entries = [
    { day: key(0), opened_at: at(0, 7), intention: "Essay" },
    { day: key(1), opened_at: at(1, 8), closed_at: at(1, 21), mood: 4 },
    { day: key(3), opened_at: at(3, 9) },
  ];
  ok("today's entry is found", D.todayEntry(entries, NOW)?.intention === "Essay");
  ok("the last visit is the latest open before today", D.lastVisit(entries, NOW) === Date.parse(at(1, 8)));
  ok("no earlier visit, no last visit", D.lastVisit([entries[0]], NOW) === null);

  const since = D.sinceLast(
    {
      sessions: [session(0, 40), session(2, 30)],
      tasks: [{ done_at: at(0, 9) }, { done_at: at(5) }],
      logs: [{ kind: "read", minutes: 20, occurred_on: key(1) }, { kind: "read", minutes: 10, occurred_on: key(0) }, { kind: "move", minutes: 30, occurred_on: key(4) }],
      discoveries: [{ title: "First hour", at: at(0, 8) }],
    },
    Date.parse(at(1, 8)),
    NOW
  );
  ok("since last: focus after then", since.focusMinutes === 40, String(since.focusMinutes));
  ok("since last: tasks after then", since.tasksDone === 1);
  ok("since last: logs from that day on", since.logged.read === 30 && !since.logged.move, JSON.stringify(since.logged));
  const lines = D.sinceLines(since);
  ok("discoveries lead the dawn", lines[0] === "Discovery: First hour", lines.join(" | "));
  ok("at most four lines", lines.length <= 4);
  ok("a quiet day still gets a kind line", /unwritten/.test(D.sinceLines({ focusMinutes: 0, tasksDone: 0, logged: {}, discoveries: [], daysAway: 1 })[0]));
  ok("a long absence says so, gently", /days away/.test(D.sinceLines({ focusMinutes: 0, tasksDone: 0, logged: {}, discoveries: [], daysAway: 9 })[0]));

  const days = new Set([key(0), key(2), key(3)]);
  const r = D.rhythm(days, NOW);
  ok("rhythm is seven days, oldest first, today last", r.week.length === 7 && r.week[6].today && r.week[6].active);
  ok("rhythm counts days shown up", r.count === 3);
  ok("the rhythm line never scolds", !/miss|lost|broke|fail/i.test([0, 1, 3, 5].map((n) => D.rhythmLine(n, false)).join(" ")));

  const sky = D.monthSky(days, NOW, "user-1");
  ok("one star per day of the month", sky.stars.length === 31 && sky.count === 31);
  ok("stars stay inside the box", sky.stars.every((s) => s.x > 0 && s.x < 100 && s.y > 0 && s.y < 60));
  ok("lit stars are the days shown up this month", sky.lit === sky.stars.filter((s) => days.has(s.key)).length);
  ok("the same month draws the same sky", JSON.stringify(D.monthSky(days, NOW, "user-1").stars) === JSON.stringify(sky.stars));
  ok("another person's sky is a different shape", JSON.stringify(D.monthSky(days, NOW, "user-2").stars) !== JSON.stringify(sky.stars));
  ok("links join lit stars in order", sky.links.length === Math.max(0, sky.lit - 1));

  ok("a closed day counts toward the ring", buildWorld({ entries: [{ day: key(0), closed_at: at(0, 21) }], now: NOW }).stats.active7 === 1);
  ok("an opened-but-not-closed day doesn't", buildWorld({ entries: [{ day: key(0), opened_at: at(0, 7) }], now: NOW }).stats.active7 === 0);
  ok("the first closed day is a discovery", discoveries({ entries: [{ day: key(1), closed_at: at(1, 21) }], now: NOW }).some((d) => d.id === "pages-1"));
  ok("day numbers count from one", D.dayNumber(at(0, 1), NOW) === 1 && D.dayNumber(at(9), NOW) === 10);
  ok("parts of the day", D.dayPart(new Date(2026, 0, 1, 8).getTime()) === "morning" && D.dayPart(new Date(2026, 0, 1, 20).getTime()) === "evening" && D.dayPart(new Date(2026, 0, 1, 2).getTime()) === "evening");
  ok("the journal lists closed days, newest first", D.journal(entries).length === 1 && D.journal(entries)[0].mood === 4);
}

// ---- weeks, seasons, the world over time (batch 2) ------------------------------
{
  // NOW is Wednesday 1 Oct 2026; last week is Mon 21 – Sun 27 Sep... check by weekday.
  const lw = C.lastWeek(NOW);
  ok("last week is seven days ending at this Monday", lw.end - lw.start >= 6.9 * DAY && lw.end - lw.start <= 7.1 * DAY && new Date(lw.end).getDay() === 1);
  const inLast = (dayOffset, h = 9) => { const d = new Date(lw.start); d.setDate(d.getDate() + dayOffset); d.setHours(h); return d.toISOString(); };
  const data = {
    sessions: [
      { started_at: inLast(0), focused_minutes: 50, subject: "Physics" },
      { started_at: inLast(2), focused_minutes: 90, subject: "Physics" },
      { started_at: inLast(2, 15), focused_minutes: 30, subject: "Chemistry" },
      { started_at: inLast(-3), focused_minutes: 60, subject: "Physics" },
    ],
    tasks: [{ created_at: inLast(0), done_at: inLast(1) }, { created_at: inLast(0), done_at: null }],
    logs: [{ kind: "read", minutes: 40, occurred_on: dayKey(new Date(inLast(3))) }],
    entries: [
      { day: dayKey(new Date(inLast(1))), closed_at: inLast(1, 21), mood: 4, intention: "Lab report", intention_done: "yes", learned: "Snell's law" },
      { day: dayKey(new Date(inLast(4))), closed_at: inLast(4, 21), mood: 3, intention: "Revise", intention_done: "no", win: "Helped Maya" },
    ],
    discoveries: [{ id: "first-focus", title: "First session", at: inLast(0) }],
  };
  const c = C.chronicle(data, lw);
  ok("the week's focus is summed", c.focusMinutes === 170, String(c.focusMinutes));
  ok("…and the week before, for comparison", c.prevFocusMinutes === 60);
  ok("the best day is found", c.best && c.best.minutes === 120);
  ok("top subjects, biggest first", c.subjects[0].subject === "Physics" && c.subjects[0].minutes === 140 && c.subjects[1].subject === "Chemistry");
  ok("tasks finished that week", c.tasksDone === 1);
  ok("logged time by kind", c.logged.read === 40);
  ok("days shown up", c.shown.length === 5, String(c.shown.length));
  ok("how the days felt, on average", c.mood === 3.5);
  ok("intentions set and kept", c.intentions === 2 && c.kept === 1);
  ok("what you wrote is kept for the chronicle", c.words.length === 2 && c.words.some((w) => w.text === "Snell's law"));
  ok("discoveries that week", c.discoveries.length === 1);
  ok("an empty week says so", C.chronicle({}, lw).empty);

  const before = C.worldAt({ ...data, bornAt: inLast(-10) }, lw.start);
  const after = C.worldAt({ ...data, bornAt: inLast(-10) }, lw.end);
  ok("the world before the week is smaller than after", after.layers.land > before.layers.land && after.stats.tasksDone === 1 && before.stats.tasksDone === 0);
  const frames = C.timeline({ ...data, bornAt: inLast(-10) }, NOW, 12);
  ok("the time-lapse has the frames asked for", frames.length === 12);
  ok("land only ever grows through the time-lapse", frames.every((f, i) => i === 0 || f.layers.land >= frames[i - 1].layers.land));
  ok("the last frame is the world today", frames[11].focusMinutes === 230);

  const s1 = C.season(at(3), NOW);
  ok("a new world is in season one, First Light", s1.number === 1 && s1.name === "First Light" && s1.day === 4);
  const s2 = C.season(at(30), NOW);
  ok("seasons are 28 days", s2.number === 2 && s2.day === 3 && s2.left === 25);

  const disc = [{ id: "a", at: at(1) }, { id: "b", at: at(40) }, { id: "c", at: at(2) }];
  const m = C.newMoments(disc, ["c"], NOW);
  ok("new moments are recent and unseen", m.fresh.length === 1 && m.fresh[0].id === "a");
  ok("old unseen ones are quietly retired", m.stale.length === 1 && m.stale[0].id === "b");
  ok("weeks of a world count from one", C.weekNumber(at(0), NOW) === 1 && C.weekNumber(at(8), NOW) === 2);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
