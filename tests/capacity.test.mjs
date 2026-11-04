// Panalo Students: how much study a day has room for. Run with
// `node tests/capacity.test.mjs`.
import { DEFAULTS } from "../students/js/model/profile.js";
import * as C from "../students/js/model/capacity.js";

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));

// The teacher's two students.
const boarder9 = { ...DEFAULTS, stage: "igcse1", boarding: true, wakeAt: "05:30", sleepAt: "21:30", schoolStart: "08:00", schoolEnd: "15:30", schoolDays: [1, 2, 3, 4, 5, 6], routine: { homework: 0 } };
const day12 = { ...DEFAULTS, stage: "a2", travelMinutes: 40, wakeAt: "06:30", sleepAt: "22:30", tuitionHours: 6, routine: { homework: 0 } };
// (Homework is 0 in these two, to test the rest; it has its own tests below.)

{
  const mon = C.dayCapacity(day12, 1);
  ok("a school day starts after school, travel home and a rest", mon.school && mon.from === 15 * 60 + 10 + 40 + 45, String(mon.from));
  ok("study ends half an hour before bed", mon.to === 22 * 60 && !mon.shortSleep);
  ok("what is left after meals, free time and coaching", mon.minutes === 154, String(mon.minutes));
  ok("a grade 12 school day is capped at 3 hours", C.dayCapacity({ ...day12, schoolEnd: "13:00", tuitionHours: 0 }, 1).minutes === 180);
  const sun = C.dayCapacity(day12, 0);
  ok("a free day starts an hour after waking", !sun.school && sun.from === 7 * 60 + 30);
  ok("and is capped at 5 hours", sun.minutes === 300);
  ok("grade 9 caps are lower", C.dayCapacity(boarder9, 1).minutes <= 120 && C.caps(9).school === 120);
}

{
  const late = { ...DEFAULTS, wakeAt: "06:00", sleepAt: "00:30" };
  const d = C.dayCapacity(late, 1);
  ok("a bedtime that leaves under 8 hours is flagged", d.shortSleep);
  ok("and the plan ends as if they slept 8 hours", d.to === 22 * 60 - 30, String(d.to));
  const fine = C.dayCapacity({ ...DEFAULTS, wakeAt: "07:00", sleepAt: "23:00" }, 1);
  ok("8 hours exactly is fine", !fine.shortSleep && fine.to === 22 * 60 + 30);
}

{
  const busy = { ...DEFAULTS, stage: "a2", travelMinutes: 90, schoolEnd: "17:00", sleepAt: "21:30", tuitionHours: 14 };
  ok("a very full day gets little or nothing, never a negative", C.dayCapacity(busy, 1).minutes >= 0 && C.dayCapacity(busy, 1).minutes < 60);
  const none = C.dayCapacity({ ...DEFAULTS, stage: "a2" }, 1).minutes;
  const tuition = C.dayCapacity({ ...DEFAULTS, stage: "a2", sleepAt: "21:00", tuitionHours: 7 }, 1).minutes;
  ok("coaching hours come off", tuition < C.dayCapacity({ ...DEFAULTS, stage: "a2", sleepAt: "21:00" }, 1).minutes && none > 0);
}

{
  const w = C.weekCapacity(day12);
  ok("a week has seven days", w.length === 7);
  ok("one lighter day, on a non-school day (Sunday)", w.filter((d) => d.light).length === 1 && w[0].light);
  ok("the buffer leaves 20% unplanned", w[1].planned === 125 && w[6].planned === 240, String(w[1].planned));
  ok("the lighter day is half", w[0].planned === 120, String(w[0].planned));
  ok("plans come in 5-minute steps", w.every((d) => d.planned % 5 === 0));
  const total = C.weekMinutes(day12);
  ok("the high-scoring day scholar plans 16 h 25 min a week", total === 985, String(total / 60));
  const b = C.weekMinutes(boarder9);
  ok("the boarder in grade 9 gets less, and still some", b > 5 * 60 && b < total, String(b / 60));
  const allSchool = C.weekCapacity({ ...DEFAULTS, schoolDays: [0, 1, 2, 3, 4, 5, 6] });
  ok("with school every day, there is still one lighter day", allSchool.filter((d) => d.light).length === 1);
}

// ---- boarders' prep ----
{
  const prep = { ...boarder9, prepStart: "18:00", prepEnd: "19:30" };
  const mon = C.dayCapacity(prep, 1);
  ok("a boarder's school day is their prep", mon.prep && mon.from === 18 * 60 && mon.to === 19 * 60 + 30);
  ok("prep is used in full: the school keeps it for study", mon.minutes === 90 && mon.fixed === 90 && C.dayCapacity({ ...prep, prepEnd: "21:00" }, 1).minutes === 180);
  ok("prep has no buffer off it", C.weekCapacity(prep)[1].planned === 90);
  ok("prep never runs into sleep", C.dayCapacity({ ...prep, prepEnd: "21:20" }, 1).to === 21 * 60);
  ok("days without school are planned as usual", !C.dayCapacity(prep, 0).prep);
  ok("a day scholar is unaffected", !C.dayCapacity({ ...DEFAULTS, prepStart: "18:00", prepEnd: "19:30" }, 1).prep);
}

// ---- boarders: several study times, and weekends (phase 36) ----
{
  const b = { ...boarder9, stage: "as", wakeAt: "06:00", sleepAt: "22:00", prepSlots: [{ start: "06:15", end: "07:00", days: [1, 2, 3, 4, 5, 6] }, { start: "18:00", end: "19:30", days: [1, 2, 3, 4, 5, 6] }, { start: "10:00", end: "12:00", days: [0] }], homeTravel: 90 };
  const mon = C.dayCapacity(b, 1);
  ok("every study time counts, in full", mon.minutes === 135 && mon.fixed === 135 && mon.windows.length === 2 && mon.from === 6 * 60 + 15 && mon.to === 19 * 60 + 30, JSON.stringify(mon));
  const stay = C.dayCapacity(b, 0, { where: "stay" });
  ok("a weekend in the hostel: weekend prep in full, and free time", stay.where === "stay" && stay.fixed === 120 && stay.minutes >= 120 && stay.minutes <= 300);
  const home = C.dayCapacity(b, 0, { where: "home", returning: true });
  ok("going home: the last day ends early for the journey back", home.where === "home" && home.to === 21 * 60 + 30 - 90 - 30 && home.fixed === 0 && home.travel === 90);
  const sat = C.dayCapacity(b, 6, { leaving: true });
  ok("the evening of leaving is travel, not prep", !sat.prep && sat.from === 15 * 60 + 30 + 90 + 45 && sat.travel === 90);
  const week = C.weekCapacity(b);
  ok("prep days keep all their time", week[1].planned === 135);
  const sunday = new Date(2026, 10, 1, 12).getTime();
  const saturday = new Date(2026, 9, 31, 12).getTime();
  ok("a date knows its weekend", C.dateCapacity(b, sunday, () => "home").where === "home" && C.dateCapacity(b, saturday, (t) => (t === sunday ? "home" : null)).travel === 90 && C.dateCapacity(b, sunday).where === "stay");
  ok("a usual weekend at home", C.dateCapacity({ ...b, weekend: "home" }, sunday).where === "home");
  const old = { ...boarder9, prepStart: "18:00", prepEnd: "19:30", prepSlots: [] };
  ok("an older profile's one prep counts on school days", C.dayCapacity(old, 3).minutes === 90 && !C.dayCapacity(old, 0).fixed);
}

// A more detailed day (phase 39): weekend times, dinner, best time, life.
{
  const wk = { ...day12, routine: { homework: 0, weekendWake: "08:00", weekendSleep: "23:30" } };
  const sun = C.dayCapacity(wk, 0);
  ok("days without school use their own wake time", sun.from === 9 * 60, String(sun.from));
  ok("and their own bedtime", sun.to === 23 * 60, String(sun.to));
  ok("school days keep the usual times", C.dayCapacity(wk, 1).to === 22 * 60);
  ok("an evening person starts later on days without school", C.dayCapacity({ ...day12, routine: { homework: 0, best: "evening" } }, 0).from === 16 * 60);
  ok("but never with under three hours left", C.dayCapacity({ ...day12, sleepAt: "18:30", routine: { homework: 0, best: "evening" } }, 0).from === 15 * 60);
  ok("a school day doesn't move for it", C.dayCapacity({ ...day12, routine: { homework: 0, best: "evening" } }, 1).from === C.dayCapacity(day12, 1).from);
  const dinner = { ...day12, routine: { homework: 0, dinnerAt: "20:00", dinnerMinutes: 45 } };
  ok("dinner is an interval", JSON.stringify(C.dinnerOn(dinner)) === "[1200,1245]" && C.dinnerOn(day12) === null);
  ok("a dinner time takes the place of the meals hour", C.dayCapacity(dinner, 1).minutes === 154, String(C.dayCapacity(dinner, 1).minutes));
  const reads = { ...day12, routine: { homework: 0, goals: { read: 120 } } };
  const week = [0, 1, 2, 3, 4, 5, 6].map((d) => C.lifeOn(reads, d));
  ok("a weekly wish is spread over the week", week.flat().reduce((n, x) => n + x.minutes, 0) === 120 && week.filter((d) => d.length).length === 4, JSON.stringify(week));
  const sporty = { ...day12, activities: [{ kind: "sport", name: "Football", days: [2, 4], start: "17:00", end: "18:00" }], routine: { homework: 0, goals: { move: 300 } } };
  ok("sport at set times counts towards moving", [0, 1, 2, 3, 4, 5, 6].reduce((n, d) => n + C.lifeOn(sporty, d).reduce((m, x) => m + x.minutes, 0), 0) === 180);
  const daily = { ...day12, routine: { homework: 0, goals: { connect: 420 } } };
  ok("an hour a day fits in the time that is theirs anyway", C.dayCapacity(daily, 1).minutes === 154 && C.lifeOn(daily, 1)[0].minutes === 60);
  const busy = { ...day12, routine: { homework: 0, goals: { connect: 420, read: 420 } } };
  ok("more than that comes off study time", C.dayCapacity(busy, 1).minutes === 94, String(C.dayCapacity(busy, 1).minutes));
  ok("an older profile has no life list", C.dayCapacity(day12, 1).life.length === 0);
}

// Homework (the review): kept free on school days, part of a boarder's prep.
{
  const hw = { ...day12, routine: {} };
  ok("a grade 12 school day keeps an hour for homework", C.homeworkOf(hw) === 60 && C.dayCapacity(hw, 1).minutes === Math.max(0, C.dayCapacity(day12, 1).minutes - 60), String(C.dayCapacity(hw, 1).minutes));
  ok("grade 9 keeps 45 minutes", C.homeworkOf({ ...boarder9, routine: {} }) === 45);
  ok("the student's own answer wins", C.homeworkOf({ ...day12, routine: { homework: 90 } }) === 90);
  ok("days without school have no homework kept", C.dayCapacity(hw, 0).minutes === C.dayCapacity(day12, 0).minutes);
  const prep = { ...boarder9, stage: "as", wakeAt: "06:00", sleepAt: "22:00", prepSlots: [{ start: "18:00", end: "20:00", days: [1, 2, 3, 4, 5] }], routine: {} };
  ok("a boarder's prep keeps time for homework", C.dayCapacity(prep, 1).minutes === 60 && C.dayCapacity(prep, 1).homework === 60, JSON.stringify(C.dayCapacity(prep, 1)));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
