// Panalo Students: your own changes to the plan. Run with `node tests/rules.test.mjs`.
import { readFileSync } from "node:fs";
import { DEFAULTS } from "../students/js/model/profile.js";
import * as P from "../students/js/model/plan.js";
import * as R from "../students/js/model/rules.js";

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));
const load = (p) => JSON.parse(readFileSync(new URL(`../students/${p}`, import.meta.url)));
// Monday 19 October 2026, 16:00 local time.
const NOW = new Date(2026, 9, 19, 16, 0).getTime();
const SUBJECTS = [{ id: "phy", name: "Physics" }, { id: "chem", name: "Chemistry" }, { id: "math", name: "Mathematics", aliases: ["maths"] }];
const opts = { subjects: SUBJECTS.map((s) => s.id), now: NOW };

// ---- rules: cleaning and changes ----
{
  const r = R.normalize({ off: [0, 9, "x", 0], minutes: { 6: 63 }, start: "25:00", weight: { phy: 1.4, nope: 2, chem: 1 }, dates: { "2026-10-18": { off: true }, "2026-10-24": { off: true }, bad: {} }, skips: ["2026-10-01|phy|1", "2026-10-20|phy|1"] }, opts);
  ok("unknown weekdays are dropped", r.off.join() === "0");
  ok("minutes round to 5", r.minutes[6] === 65);
  ok("a bad time is dropped", r.start === null);
  ok("weights snap to the nearest step; unknown subjects and 'normal' dropped", r.weight.phy === 1.5 && !("nope" in r.weight) && !("chem" in r.weight));
  ok("past days are forgotten", !("2026-10-18" in r.dates) && r.dates["2026-10-24"]?.off && r.skips.length === 1);
  ok("empty rules are empty", R.isEmpty(R.empty()) && !R.isEmpty(r));

  let x = R.applyChanges(R.empty(), [{ op: "day_off", weekday: 0 }, { op: "day_minutes", weekday: 6, minutes: 60 }, { op: "start_after", time: "17:00" }, { op: "subject_weight", subject: "math", weight: 2 }], opts);
  ok("changes apply", x.off.join() === "0" && x.minutes[6] === 60 && x.start === "17:00" && x.weight.math === 2);
  x = R.applyChanges(x, [{ op: "day_minutes", weekday: 0, minutes: 30 }], opts);
  ok("a cap on a day off turns it back on", !x.off.includes(0) && x.minutes[0] === 30);
  x = R.applyChanges(x, [{ op: "reset" }], opts);
  ok("reset clears everything", R.isEmpty(x));
  const lines = R.describe(R.applyChanges(R.empty(), [{ op: "day_off", weekday: 0 }, { op: "subject_weight", subject: "chem", weight: 0 }], opts), { nameOf: (s) => SUBJECTS.find((x) => x.id === s).name, now: NOW });
  ok("described in plain words", lines.map((l) => l.text).join("; ") === "Sundays off; Chemistry: paused", lines.map((l) => l.text).join("; "));
  const back = R.undo(R.applyChanges(R.empty(), [{ op: "day_off", weekday: 0 }], opts), lines[0].undo, opts);
  ok("each line can be undone", R.isEmpty(back));
}

// ---- understanding a sentence (without Pan) ----
{
  const u = (t) => R.understand(t, { subjects: SUBJECTS, now: NOW }).changes;
  const has = (cs, c) => cs.some((x) => Object.entries(c).every(([k, v]) => x[k] === v));
  ok("'no study on sundays'", has(u("no study on sundays"), { op: "day_off", weekday: 0 }));
  ok("'saturdays off'", has(u("Saturdays off please"), { op: "day_off", weekday: 6 }));
  ok("'only 1 hour on saturdays'", has(u("only 1 hour on saturdays"), { op: "day_minutes", weekday: 6, minutes: 60 }));
  ok("'this saturday off' is a one-off", has(u("I'm busy this saturday"), { op: "date_off", date: "2026-10-24" }));
  ok("'only 1 hour on saturday' means every Saturday", has(u("only 1 hour on Saturday"), { op: "day_minutes", weekday: 6, minutes: 60 }));
  ok("'next friday off' is a one-off", has(u("next friday off"), { op: "date_off", date: "2026-10-23" }));
  ok("'skip tomorrow'", has(u("skip tomorrow"), { op: "date_off", date: "2026-10-20" }));
  ok("'just 30 min today'", has(u("just 30 min today"), { op: "date_minutes", date: "2026-10-19", minutes: 30 }));
  ok("'start after 5'", has(u("don't start before 5... start after 5"), { op: "start_after", time: "17:00" }));
  ok("'not before 6:30 pm'", has(u("not before 6:30 pm"), { op: "start_after", time: "18:30" }));
  const mix = u("more maths and less chemistry");
  ok("'more maths and less chemistry'", has(mix, { op: "subject_weight", subject: "math", weight: 1.5 }) && has(mix, { op: "subject_weight", subject: "chem", weight: 0.5 }));
  ok("'pause physics'", has(u("pause physics for now"), { op: "subject_weight", subject: "phy", weight: 0 }));
  ok("'weekends off'", has(u("weekends off"), { op: "day_off", weekday: 0 }) && has(u("weekends off"), { op: "day_off", weekday: 6 }));
  ok("'crash day on saturday' is a one-off crash day", has(u("crash day on saturday"), { op: "date_crash", date: "2026-10-24" }));
  ok("'make tomorrow a crash day'", has(u("make tomorrow a crash day"), { op: "date_crash", date: "2026-10-20" }));
  ok("'back to normal'", has(u("back to normal"), { op: "reset" }));
  ok("nonsense changes nothing", u("what is the capital of france").length === 0);
}

// ---- the plan follows the rules ----
{
  const profile = { ...DEFAULTS, board: "cambridge", stage: "as", aim: "good", subjects: [{ id: "phy", level: 2 }, { id: "chem", level: 3 }, { id: "math", level: 1 }], wakeAt: "06:30", sleepAt: "22:30" };
  const syllabi = {};
  for (const s of profile.subjects) syllabi[s.id] = load(P.syllabusPath(profile.stage, s.id));
  const base = P.buildPlan({ profile, syllabi, now: NOW });
  const plan = (changes) => P.buildPlan({ profile, syllabi, now: NOW, rules: R.applyChanges(R.empty(), changes, opts) });
  const sunday = (p) => p.find((d) => d.weekday === 0);
  ok("the base plan studies on Sunday", sunday(base).blocks.length > 0);
  ok("a day off has nothing", sunday(plan([{ op: "day_off", weekday: 0 }])).blocks.length === 0 && sunday(plan([{ op: "day_off", weekday: 0 }])).off);
  const capped = plan([{ op: "day_minutes", weekday: 0, minutes: 30 }]);
  ok("a capped day stays under its cap", sunday(capped).minutes <= 30 && sunday(capped).minutes > 0, sunday(capped).minutes);
  const late = plan([{ op: "start_after", time: "19:00" }]);
  ok("nothing starts before the start time", late.every((d) => d.blocks.every((b) => b.start >= 19 * 60)));
  const paused = plan([{ op: "subject_weight", subject: "chem", weight: 0 }]);
  ok("a paused subject has no blocks", paused.every((d) => d.blocks.every((b) => b.subject !== "chem")));
  const count = (p, s) => p.reduce((n, d) => n + d.blocks.filter((b) => b.subject === s).length, 0);
  const more = plan([{ op: "subject_weight", subject: "math", weight: 2 }]);
  ok("more of a subject means more of its blocks", count(more, "math") > count(base, "math"), `${count(base, "math")} → ${count(more, "math")}`);
  const first = base[0].blocks[0];
  const skipped = plan([{ op: "skip", date: "2026-10-19", subject: first.subject, topic: first.topic }]);
  ok("a skipped block isn't there that day", !skipped[0].blocks.some((b) => b.subject === first.subject && b.topic === first.topic));
  const later = base.slice(1).flatMap((d) => d.blocks).find((b) => !base[0].blocks.some((x) => x.subject === b.subject && x.topic === b.topic));
  const pinned = plan([{ op: "pin", date: "2026-10-19", subject: later.subject, topic: later.topic, kind: later.kind }]);
  ok("a block pulled into today goes first", pinned[0].blocks[0].subject === later.subject && pinned[0].blocks[0].topic === later.topic && pinned[0].blocks[0].pinned);
}

// ---- real life: activities, the calendar, crash days ----
{
  const base = { ...DEFAULTS, board: "cambridge", stage: "as", aim: "good", subjects: [{ id: "phy", level: 2 }, { id: "chem", level: 3 }, { id: "math", level: 1 }], wakeAt: "06:30", sleepAt: "22:30" };
  const syllabi = {};
  for (const s of base.subjects) syllabi[s.id] = load(P.syllabusPath(base.stage, s.id));
  const overlaps = (b, [a, z]) => b.start < z && b.start + b.minutes > a;
  // Football on Tuesdays and Thursdays, 17:00-18:30.
  const profile = { ...base, activities: [{ kind: "sport", name: "Football", days: [2, 4], start: "17:00", end: "18:30" }] };
  const plan = P.buildPlan({ profile, syllabi, now: NOW });
  const tue = plan.find((d) => d.weekday === 2);
  ok("no block goes over a fixed activity", tue.blocks.length > 0 && tue.blocks.every((b) => !overlaps(b, [17 * 60 - 15, 18 * 60 + 30 + 15])), JSON.stringify(tue.blocks.map((b) => [b.start, b.minutes])));
  const without = P.buildPlan({ profile: base, syllabi, now: NOW }).find((d) => d.weekday === 2);
  ok("…and the day holds less", tue.minutes <= without.minutes, `${without.minutes} → ${tue.minutes}`);
  // A function on Wednesday 21 Oct, 16:00-21:00, from the calendar.
  const fn = { kind: "personal", title: "Cousin's function", starts_at: new Date(2026, 9, 21, 16, 0).toISOString(), ends_at: new Date(2026, 9, 21, 21, 0).toISOString() };
  const withFn = P.buildPlan({ profile: base, syllabi, now: NOW, events: [fn] });
  const wed = withFn.find((d) => d.weekday === 3);
  ok("a calendar entry with times blocks that time", wed.blocks.every((b) => !overlaps(b, [16 * 60, 21 * 60])) && wed.minutes < without.minutes + 999);
  ok("…with a rest after something long: only a short block fits after it", wed.minutes <= 15 && wed.blocks.every((b) => b.start >= 21 * 60 + 45), JSON.stringify(wed.blocks.map((b) => [b.start, b.minutes])));
  // Weekly class at 18:00-19:00 on Mondays (from the timetable).
  const cls = { kind: "class", title: "Evening class", starts_at: new Date(2026, 8, 7, 18, 0).toISOString(), ends_at: new Date(2026, 8, 7, 19, 0).toISOString(), repeat_weekly: true };
  const nextMon = P.buildPlan({ profile: base, syllabi, now: NOW, events: [cls] }).filter((d) => d.weekday === 1).pop();
  ok("a weekly class is kept clear every week", nextMon.blocks.every((b) => !overlaps(b, [18 * 60, 19 * 60])));
  // A crash day on Saturday 24 Oct.
  const normal = P.buildPlan({ profile: base, syllabi, now: NOW }).find((d) => d.weekday === 6);
  const crash = P.buildPlan({ profile: base, syllabi, now: NOW, rules: R.applyChanges(R.empty(), [{ op: "date_crash", date: "2026-10-24" }], opts) }).find((d) => d.weekday === 6);
  ok("a crash day holds more than a normal one", crash.crash && crash.minutes > normal.minutes, `${normal.minutes} → ${crash.minutes}`);
  ok("…but never more than six hours", crash.minutes <= 360);
}

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
