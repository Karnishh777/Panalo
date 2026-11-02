// Panalo Students: autopilot (the plan changes itself and says what changed).
// Run with `node tests/autopilot.test.mjs`.
import * as A from "../students/js/model/autopilot.js";
import * as R from "../students/js/model/rules.js";

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));
// Monday 19 October 2026, 16:00 local time.
const NOW = new Date(2026, 9, 19, 16, 0).getTime();
const day = (d) => new Date(2026, 9, d).getTime();
const blk = (subject, topic, start, minutes = 25, kind = "learn") => ({ subject, subjectName: subject.toUpperCase(), topic, topicName: `T${topic}`, kind, start, minutes });

// ---- what changed between two plans ----
{
  const before = [{ date: day(19), blocks: [blk("phy", "1", 17 * 60), blk("chem", "2", 19 * 60)] }, { date: day(20), blocks: [blk("math", "3", 17 * 60)] }];
  const after = [{ date: day(19), blocks: [blk("chem", "2", 19 * 60)] }, { date: day(23), blocks: [blk("phy", "1", 17 * 60)] }];
  const d = A.diffPlans(before, after, { now: NOW });
  ok("a block that moved is found, with both times", d.moved.length === 1 && d.moved[0].block.subject === "phy" && d.moved[0].to === day(23) + 17 * 3600000 && d.moved[0].from === day(19) + 17 * 3600000);
  ok("a block that left the week is found", d.dropped.length === 1 && d.dropped[0].block.subject === "math");
  ok("an unchanged block is kept", d.kept === 1);
  const past = A.diffPlans([{ date: day(19), blocks: [blk("phy", "1", 9 * 60)] }], [{ date: day(19), blocks: [] }], { now: NOW });
  ok("a block already past is not called dropped", past.dropped.length === 0);
}

// ---- missed blocks ----
{
  const snap = A.flatten([{ date: day(19), blocks: [blk("phy", "1", 14 * 60), blk("chem", "2", 15 * 60), blk("math", "3", 18 * 60)] }]);
  const m = A.missed(snap, { now: NOW, sessions: [{ started_at: new Date(2026, 9, 19, 15, 10).toISOString(), subject: "CHEM" }] });
  ok("a past block with nothing done is missed", m.length === 1 && m[0].subject === "phy", JSON.stringify(m.map((b) => b.subject)));
  ok("a later block isn't missed yet", !m.some((b) => b.subject === "math"));
}

// ---- something came up, energy ----
{
  const today = R.dateKey(NOW);
  const opts = { subjects: ["phy"], now: NOW };
  ok("an extra class takes the rest of today off", JSON.stringify(A.comeUp("class", { now: NOW })) === JSON.stringify([{ op: "date_off", date: today }]));
  const ill = R.applyChanges(R.empty(), A.comeUp("ill", { now: NOW }), opts);
  ok("ill: today off, tomorrow light", ill.dates[today]?.off && ill.dates["2026-10-20"]?.minutes === 45);
  const tired = A.comeUp("tired", { now: NOW, plannedToday: 90 })[0];
  ok("tired: a much shorter today", tired.op === "date_minutes" && tired.minutes === 35);
  ok("an unknown reason changes nothing", A.comeUp("??", { now: NOW }).length === 0);
  const low = R.applyChanges(R.empty(), A.energy("low", { now: NOW, plannedToday: 90 }), opts);
  ok("low energy halves today", low.dates[today]?.minutes === 45);
  ok("…and reads back as low", A.energyOf(low, { now: NOW, plannedToday: 90 }) === "low");
  const high = R.applyChanges(R.empty(), A.energy("high", { now: NOW, plannedToday: 90 }), opts);
  ok("high energy adds half an hour", high.dates[today]?.minutes === 120 && A.energyOf(high, { now: NOW, plannedToday: 90 }) === "high");
  const back = R.applyChanges(high, A.energy("ok", { now: NOW }), opts);
  ok("OK puts today back as planned", !back.dates[today] && A.energyOf(back, { now: NOW, plannedToday: 90 }) === "ok");
}

// ---- the week, looked back and ahead ----
{
  const s = (d, h, m, subject) => ({ started_at: new Date(2026, 9, d, h).toISOString(), focused_minutes: m, subject });
  const w = A.weekLookBack([s(19, 10, 25, "phy"), s(19, 15, 20, "chem"), s(17, 10, 50, "phy"), s(21, 9, 30, "phy")], { now: new Date(2026, 9, 21, 20).getTime() });
  ok("the week counts from Monday", w.minutes === 75 && w.days === 2 && w.bySubject.phy === 55, JSON.stringify(w));
  const plan = [{ date: day(26), blocks: [blk("phy", "1", 17 * 60, 40), blk("chem", "2", 18 * 60, 25)] }, { date: day(27), blocks: [blk("phy", "3", 17 * 60, 25)] }, { date: day(28), blocks: [blk("chem", "4", 17 * 60, 15)] }];
  const a = A.weekAhead(plan, { nameOf: (x) => ({ phy: "Physics", chem: "Chemistry" })[x], events: [{ kind: "exam", title: "Physics mock", starts_at: new Date(2026, 9, 28, 9).toISOString() }] });
  ok("ahead: where the time goes", a.total === 105 && /Physics gets the most time: 62%/.test(a.lines[0]), a.lines.join(" | "));
  ok("ahead: an exam in the week is named, with the day before", a.lines.some((l) => /Physics mock is Wednesday, so Tuesday is for going over it/.test(l)), a.lines.join(" | "));
  ok("ahead: the lightest day", a.lines.some((l) => /Wednesday is the lightest day/.test(l)), a.lines.join(" | "));
}

if (failures.length) {
  console.log(`autopilot: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.log("  FAIL", f);
  process.exit(1);
}
console.log(`autopilot: all ${passed} passed`);
