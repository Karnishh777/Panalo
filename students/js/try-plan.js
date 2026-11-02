// The front page's try-it (v0.3): three taps -- which exams, which subjects,
// when -- and a first week built by the same planner the app uses, with no
// account. Nothing is saved; "Keep this plan" goes on to sign-up.
import { el } from "./ui.js";
import { DEFAULTS } from "./model/profile.js";
import { STAGES, subjectsFor } from "./model/subjects.js";
import { buildPlan, syllabusPath } from "./model/plan.js";
import { upcomingSeries, seriesLabel } from "./model/papers.js";
import { cometMark } from "./comet.js";

const SOON = [
  { label: "ICSE and ISC", sub: "Coming next" },
  { label: "CBSE", sub: "After ICSE" },
];
const LIKELY = ["phy", "chem", "math", "bio", "eng1", "eng"];
const fmt = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h} h ${m}` : `${h} h`) : `${m} min`;
};
const clock = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

export function initTryPlan(root) {
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";
  const state = { step: 0, stage: null, picked: [], series: null };
  const body = el("div", { class: "try-body", "aria-live": "polite" });
  const bars = [0, 1, 2].map(() => el("i"));
  const label = el("span", { class: "hud-label" });
  root.append(el("div", { class: "try-top" }, [label, el("span", { class: "try-bars", "aria-hidden": "true" }, bars)]), body);

  const chip = (text, sub, { on = false, disabled = false, onClick } = {}) =>
    el("button", { type: "button", class: `try-chip${on ? " on" : ""}`, "aria-pressed": on ? "true" : null, disabled: disabled ? "" : null, onclick: onClick }, [
      el("b", { text }),
      sub ? el("small", { text: sub }) : null,
    ]);

  const draw = () => {
    bars.forEach((b, i) => b.classList.toggle("on", state.step > i));
    label.textContent = state.step < 3 ? `Tap ${state.step + 1} of 3` : "Your first week";
    body.replaceChildren(...[stepStage, stepSubjects, stepSeries, stepWeek][state.step]());
  };

  const stepStage = () => [
    el("h3", { class: "try-q", text: "Which exams?" }),
    el("div", { class: "try-grid" }, [
      ...STAGES.cambridge.map((s) =>
        chip(s.label === "AS" ? "Cambridge AS" : s.label === "A2" ? "Cambridge A Level" : `${s.label} · Cambridge IGCSE`, s.sub, {
          on: state.stage === s.id,
          onClick: () => {
            state.stage = s.id;
            const ids = subjectsFor(s.id).map((x) => x.id);
            state.picked = LIKELY.filter((id) => ids.includes(id)).slice(0, 3);
            state.step = 1;
            draw();
          },
        })
      ),
      ...SOON.map((s) => chip(s.label, s.sub, { disabled: true })),
    ]),
  ];

  const stepSubjects = () => {
    const all = subjectsFor(state.stage);
    return [
      el("h3", { class: "try-q", text: "Your subjects" }),
      el("p", { class: "try-hint", text: "Tap all that apply. The usual papers are picked for you." }),
      el(
        "div",
        { class: "try-wrap" },
        all.map((s) => {
          const on = state.picked.includes(s.id);
          return chip(s.name, null, {
            on,
            onClick: () => {
              state.picked = on ? state.picked.filter((x) => x !== s.id) : [...state.picked, s.id].slice(0, 9);
              draw();
            },
          });
        })
      ),
      el("div", { class: "try-actions" }, [
        el("button", { type: "button", class: "btn btn-quiet", text: "Back", onclick: () => ((state.step = 0), draw()) }),
        el("button", {
          type: "button",
          class: "btn btn-primary",
          disabled: state.picked.length ? null : "",
          text: state.picked.length ? `Next · ${state.picked.length} chosen` : "Pick at least one",
          onclick: () => ((state.step = 2), draw()),
        }),
      ]),
    ];
  };

  const stepSeries = () => [
    el("h3", { class: "try-q", text: "When are the exams?" }),
    el(
      "div",
      { class: "try-grid" },
      upcomingSeries(Date.now(), 3).map((key) =>
        chip(seriesLabel(key), null, {
          onClick: () => {
            state.series = key;
            state.step = 3;
            draw();
          },
        })
      )
    ),
    el("div", { class: "try-actions" }, [el("button", { type: "button", class: "btn btn-quiet", text: "Back", onclick: () => ((state.step = 1), draw()) })]),
  ];

  const stepWeek = () => {
    const out = el("div", { class: "try-week" }, [el("p", { class: "try-hint", text: "Building it…" })]);
    week(state).then(
      (days) => out.replaceChildren(...weekView(days)),
      () => out.replaceChildren(el("p", { class: "try-hint", text: "The plan couldn't be built just now. Try again in a moment." }))
    );
    return [
      el("div", { class: "try-done" }, [
        cometMark({ streaks: state.picked.length, lit: 0, width: 86 }),
        el("div", {}, [el("span", { class: "hud-label mint", text: "Done in three taps" }), el("h3", { class: "try-q", text: "Here it is." })]),
      ]),
      out,
      el("p", { class: "try-hint", text: "Built around a 3:10 pm end to school and lights out at 10. After sign-up, add your real timetable." }),
      el("div", { class: "try-actions" }, [
        el("button", { type: "button", class: "btn btn-quiet", text: "Start again", onclick: () => Object.assign(state, { step: 0, stage: null, picked: [], series: null }) && draw() }),
        el("a", { class: "btn btn-primary", href: "#signup", text: "Keep this plan" }),
      ]),
    ];
  };

  draw();
}

// The same planner the app runs, on a made-up but ordinary school week.
async function week({ stage, picked, series }) {
  const profile = { ...DEFAULTS, board: "cambridge", stage, subjects: picked.map((id) => ({ id, level: 2, series })) };
  const syllabi = {};
  await Promise.all(
    picked.map(async (id) => {
      const path = syllabusPath(stage, id);
      syllabi[id] = path ? await fetch(path).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
    })
  );
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  // From tomorrow, so the week starts whole whatever the hour.
  return buildPlan({ profile, syllabi, now: midnight.getTime() + 86400000, days: 7 });
}

function weekView(days) {
  return days.slice(0, 7).map((d) => {
    const min = d.blocks.reduce((n, b) => n + b.minutes, 0);
    const day = new Date(d.date).toLocaleDateString("en-GB", { weekday: "short" });
    const what = d.blocks.length
      ? d.blocks
          .slice(0, 2)
          .map((b) => `${b.subjectName}: ${b.topicName || "review"}`)
          .join(" · ") + (d.blocks.length > 2 ? ` · +${d.blocks.length - 2}` : "")
      : "Rest";
    return el("div", { class: "try-day" }, [
      el("span", { class: "try-dname", text: day }),
      el("span", { class: "try-what", text: what }),
      el("span", { class: "try-min", text: min ? `${d.blocks[0] ? clock(d.blocks[0].start) + " · " : ""}${fmt(min)}` : "—" }),
    ]);
  });
}
