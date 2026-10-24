// Panalo Students: how much study a day has room for. Run with
// `node tests/capacity.test.mjs`.
import { DEFAULTS } from "../students/js/model/profile.js";
import * as C from "../students/js/model/capacity.js";

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));

// The teacher's two students.
const boarder9 = { ...DEFAULTS, stage: "igcse1", boarding: true, wakeAt: "05:30", sleepAt: "21:30", schoolStart: "08:00", schoolEnd: "15:30", schoolDays: [1, 2, 3, 4, 5, 6] };
const day12 = { ...DEFAULTS, stage: "a2", travelMinutes: 40, wakeAt: "06:30", sleepAt: "22:30", tuitionHours: 6 };

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
  ok("prep is capped like any school day (grade 9: 2 h)", mon.minutes === 90 && C.dayCapacity({ ...prep, prepEnd: "21:00" }, 1).minutes === 120);
  ok("prep never runs into sleep", C.dayCapacity({ ...prep, prepEnd: "21:20" }, 1).to === 21 * 60);
  ok("days without school are planned as usual", !C.dayCapacity(prep, 0).prep);
  ok("a day scholar is unaffected", !C.dayCapacity({ ...DEFAULTS, prepStart: "18:00", prepEnd: "19:30" }, 1).prep);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
