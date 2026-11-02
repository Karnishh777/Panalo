// Today on autopilot (v0.3): one plain line says what moved in the plan
// since the morning; one tap changes today for low or high energy; and
// "Something came up" reshapes today (and, when ill, tomorrow) for a reason
// picked from a list. Every change of the student's own can be undone.
// The rules come from model/autopilot.js; nothing here asks for typing.
import { el, openSheet, reportError } from "./ui.js";
import { currentPlan, planRules, changePlan, saveRules, profile, subjectView, nameOf } from "./planner.js";
import { store } from "./store.js";
import * as A from "./model/autopilot.js";
import { dateKey } from "./model/rules.js";
import { streaksFor } from "./model/streaks.js";
import { clockOf, formatMinutes } from "./model/time.js";
import { cometMark } from "./comet.js";

const KEY = "panalo.students.autopilot";
const ENERGY_KEY = "panalo.students.energy";
const SUNDAY_KEY = "panalo.students.sunday";
const DAY = 86400000;

/**
 * Sunday (or Monday morning, if Sunday went by): the week looked back on
 * and the next one in three plain sentences, until "Looks right".
 */
export function sundayCard(now = Date.now(), rerender = () => {}) {
  const d = new Date(now);
  const due = d.getDay() === 0 || (d.getDay() === 1 && d.getHours() < 12);
  // The week being looked back on: this one on Sunday, last week on Monday.
  const week = A.weekStart(d.getDay() === 1 ? now - DAY : now);
  if (!due || read(SUNDAY_KEY) === week) return null;
  const back = A.weekLookBack(store.sessions || [], { now: week + 3 * DAY });
  const ahead = A.weekAhead(currentPlan({ now, days: 7 }), { nameOf, events: store.events || [] });
  return el("section", { class: "sunday-card hud-frame", "aria-labelledby": "sunday-h" }, [
    el("span", { class: "hud-label", text: d.getDay() === 0 ? "Sunday · the week in a minute" : "Monday · last week in a minute" }),
    el("h2", { id: "sunday-h", class: "serif", text: back.minutes ? `${formatMinutes(back.minutes)} studied, on ${back.days} of 7 days.` : "A quiet week. Next week starts fresh." }),
    ahead.lines.length ? el("ul", { class: "sunday-lines" }, ahead.lines.map((l) => el("li", { text: l }))) : null,
    el("div", { class: "ap-row" }, [
      el("a", { class: "btn btn-quiet btn-sm", href: "#/plan", text: "See the week" }),
      el("button", { type: "button", class: "btn btn-primary btn-sm", id: "sunday-ok", text: "Looks right", onClick: () => (write(week, SUNDAY_KEY), rerender()) }),
    ]),
  ]);
}
// The last change the student made here, and the rules from before it.
let undo = null;

const read = (key = KEY) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
};
const write = (v, key = KEY) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Private windows: the note simply starts fresh next time.
  }
};

// Today's energy as picked here. It holds while today still has the cap it
// set: a cap changed elsewhere (the plan editor, Pan) reads as "as planned".
function energyLevel(now) {
  const e = read(ENERGY_KEY);
  const cap = planRules(now).dates?.[dateKey(now)]?.minutes;
  return e?.day === dateKey(now) && cap != null && cap === e.minutes ? e.level : "ok";
}
const slim = (blocks) => blocks.map((b) => ({ subject: b.subject, topic: b.topic, kind: b.kind, at: b.at, subjectName: b.subjectName, topicName: b.topicName, minutes: b.minutes, start: 0 }));
// Back into the shape model/autopilot.js reads (one "day" holding moments).
const asPlan = (blocks) => [{ date: 0, blocks: blocks.map((b) => ({ ...b, start: b.at / 60000 })) }];

/** The plan as it was this morning (saved the first time Today is opened each day). */
function snapshot(now) {
  const s = read();
  if (s?.day === dateKey(now) && Array.isArray(s.blocks)) return s.blocks;
  const blocks = slim(A.flatten(currentPlan({ now, days: 7 })));
  write({ day: dateKey(now), blocks });
  return blocks;
}

function seen(now) {
  write({ day: dateKey(now), blocks: slim(A.flatten(currentPlan({ now, days: 7 }))) });
}

function plannedToday(now) {
  return (currentPlan({ now, days: 1 })[0]?.blocks || []).reduce((n, b) => n + b.minutes, 0);
}

const when = (at, now) => {
  const d = new Date(at);
  const day = dateKey(at) === dateKey(now) ? "today" : d.toLocaleDateString("en-GB", { weekday: "long" });
  return `${day} ${clockOf(d.getHours() * 60 + d.getMinutes())}`;
};

/** The student's comet: a streak per subject, lit when the subject is at their target. */
export function subjectComet({ width = 72 } = {}) {
  const views = profile().subjects.map((s) => subjectView(s));
  const target = views[0]?.target ?? 0.75;
  return cometMark({ ...streaksFor(views.map((v) => v.readiness), { ready: target }), width });
}

async function change(changes, text, rerender) {
  const before = planRules();
  try {
    await changePlan(changes);
    undo = { text, before };
  } catch (e) {
    reportError(e, "The plan couldn't be changed. Try again.");
  }
  rerender();
}

export function autopilotPanel({ now = Date.now(), rerender }) {
  const moved = A.diffPlans(asPlan(snapshot(now)), currentPlan({ now, days: 7 }), { now }).moved.slice(0, 3);
  const level = energyLevel(now);

  let note;
  if (undo) {
    note = el("div", { class: "ap-note" }, [
      el("p", {}, [el("span", { class: "hud-label", text: "Changed" }), el("span", { text: undo.text })]),
      el("button", {
        type: "button",
        class: "btn btn-quiet btn-sm",
        id: "ap-undo",
        text: "Undo",
        onClick: async () => {
          const prev = undo.before;
          undo = null;
          try {
            await saveRules(prev);
          } catch (e) {
            reportError(e, "That couldn't be undone. Try again.");
          }
          rerender();
        },
      }),
    ]);
  } else if (moved.length) {
    note = el("div", { class: "ap-note" }, [
      el("div", {}, [
        el("span", { class: "hud-label", text: `Moved since this morning: ${moved.length === 1 ? "1 thing" : `${moved.length} things`}` }),
        el(
          "ul",
          { class: "ap-moves" },
          moved.map((m) => el("li", { text: `${m.block.subjectName}${m.block.topicName ? `: ${m.block.topicName}` : ""}, now ${when(m.to, now)}` }))
        ),
      ]),
      el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Got it", onClick: () => (seen(Date.now()), rerender()) }),
    ]);
  } else {
    const left = plannedToday(now);
    note = el("div", { class: "ap-note" }, [el("p", {}, [el("span", { class: "hud-label", text: "Today" }), el("span", { text: left ? `${left} minutes planned for the rest of today. Nothing has needed moving.` : "Nothing more planned today. The rest of the day is yours." })])]);
  }

  const chip = (id, label) =>
    el("button", {
      type: "button",
      class: `ap-chip${level === id ? " on" : ""}`,
      "aria-pressed": level === id ? "true" : "false",
      "data-energy": id,
      text: label,
      onClick: () => {
        if (level === id) return;
        const p = plannedToday(Date.now());
        const ops = A.energy(id, { now: Date.now(), plannedToday: p });
        const text = id === "low" ? `A lighter day: about ${ops[0].minutes} minutes left today.` : id === "high" ? `A fuller day: up to ${ops[0].minutes} minutes today.` : "Today is back to the plan.";
        write({ day: dateKey(Date.now()), level: id, minutes: ops[0].minutes ?? null }, ENERGY_KEY);
        change(ops, text, rerender);
      },
    });

  return el("section", { class: "autopilot-panel", "aria-label": "Autopilot" }, [
    subjectComet({ width: 72 }),
    el("div", { class: "ap-main" }, [
      note,
      el("div", { class: "ap-row" }, [
        el("span", { class: "hud-label", text: "Energy" }),
        ...A.ENERGY.map((e) => chip(e.id, e.label)),
        el("button", { type: "button", class: "ap-chip ap-came", id: "ap-came-up", text: "Something came up", onClick: () => cameUp(rerender) }),
      ]),
    ]),
  ]);
}

function cameUp(rerender) {
  const sheet = openSheet({
    title: "What happened?",
    lead: "One tap. The week is rearranged; nothing is lost.",
    form: false,
    cls: "came-up",
    body: A.REASONS.map((r) =>
      el("button", {
        type: "button",
        class: "ap-reason",
        "data-reason": r.id,
        text: r.label,
        onClick: async () => {
          const now = Date.now();
          const ops = A.comeUp(r.id, { now, plannedToday: plannedToday(now) });
          const text =
            r.id === "tired" ? `A short evening: about ${ops[0].minutes} minutes.` : r.id === "ill" ? "Rest today; tomorrow is light. Today's work moved later in the week." : "The rest of today is off. Its work moved later in the week.";
          sheet.close();
          await change(ops, text, rerender);
        },
      })
    ),
  });
}
