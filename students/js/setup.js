// The setup (v0.2): about 90 seconds, one question a screen, mostly one tap
// each. It asks what the planner needs -- board, year, subjects and how
// each is going, the aim, the school day, boarding or travel, sleep,
// tuition and any exams coming up -- and saves it to the study profile
// (phase 29). It replaces the old intro film.
import { el, chipGroup, showToast, reportError } from "./ui.js";
import { api, store } from "./store.js";
import { BOARDS, STAGES, AIMS, LEVELS, subjectsFor, gradesFor } from "./model/subjects.js";
import { toRow, fromRow } from "./model/profile.js";

const $ = (id) => document.getElementById(id);
const DAYS = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 0, label: "Sun" },
];

// A big choice: a label and a line under it.
function choices(options, value, onPick) {
  const wrap = el("div", { class: "setup-choices", role: "radiogroup" });
  const render = () =>
    wrap.replaceChildren(
      ...options.map((o) =>
        el(
          "button",
          {
            type: "button",
            class: "setup-choice",
            role: "radio",
            "aria-checked": String(o.id === value()),
            onClick: () => {
              onPick(o.id);
              render();
            },
          },
          [el("b", { text: o.label }), o.sub ? el("small", { text: o.sub }) : null]
        )
      )
    );
  render();
  return wrap;
}

function timeInput(id, value, onChange) {
  const input = el("input", { type: "time", id, value, step: "300", required: "" });
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

/**
 * Run the setup. `onDone` is called once it's saved (or, editing an
 * existing profile, closed).
 * @param {{ onDone: () => void, editing?: boolean }} opts
 */
export function runSetup({ onDone, editing = false }) {
  const root = $("setup");
  const form = $("setup-form");
  root.hidden = false;
  document.body.classList.add("in-setup");

  const a = { ...fromRow(store.student) };
  if (!a.subjects.length) a.subjects = [];
  const exams = [];

  const steps = [
    {
      id: "board",
      title: "Which board are you with?",
      lead: "Panalo plans with your syllabus, so this comes first.",
      body: () => [choices(BOARDS, () => a.board, (id) => {
        if (a.board !== id) {
          a.board = id;
          a.stage = STAGES[id].length === 1 ? STAGES[id][0].id : null;
          a.subjects = [];
        }
      })],
      ok: () => !!a.board || "Choose your board.",
    },
    {
      id: "stage",
      title: "Which year are you in?",
      lead: "This sets your syllabus and how close your exams are.",
      skip: () => (STAGES[a.board] || []).length < 2,
      body: () => [choices(STAGES[a.board] || [], () => a.stage, (id) => {
        if (a.stage !== id) {
          const keep = new Set(subjectsFor(id).map((s) => s.id));
          a.stage = id;
          a.subjects = a.subjects.filter((s) => keep.has(s.id));
        }
      })],
      ok: () => !!a.stage || "Choose your year.",
    },
    {
      id: "subjects",
      title: "Your subjects",
      lead: "Tap every subject you take. You can change them later in Settings.",
      body: () => {
        const chosen = new Set(a.subjects.map((s) => s.id));
        return [
          el(
            "div",
            { class: "chips setup-subjects", role: "group", "aria-label": "Subjects" },
            subjectsFor(a.stage).map((s) => {
              const b = el("button", { type: "button", class: "chip tone-focus", "aria-pressed": String(chosen.has(s.id)) }, [
                el("span", { text: s.name }),
                s.code ? el("small", { class: "num", text: ` ${s.code}` }) : null,
              ]);
              b.addEventListener("click", () => {
                if (chosen.has(s.id)) {
                  chosen.delete(s.id);
                  a.subjects = a.subjects.filter((x) => x.id !== s.id);
                } else if (chosen.size >= 16) return showToast("That's the most Panalo can plan for at once.", "");
                else {
                  chosen.add(s.id);
                  a.subjects.push({ id: s.id, level: 2 });
                }
                b.setAttribute("aria-pressed", String(chosen.has(s.id)));
              });
              return b;
            })
          ),
        ];
      },
      ok: () => a.subjects.length > 0 || "Pick at least one subject.",
    },
    {
      id: "levels",
      title: "How is each one going?",
      lead: "Be honest: weaker subjects get more time in your plan. Your last grade is optional.",
      body: () => {
        const offered = subjectsFor(a.stage);
        const grades = gradesFor(a.stage);
        return [
          el(
            "div",
            { class: "setup-levels" },
            a.subjects.map((s) => {
              const name = offered.find((o) => o.id === s.id)?.name || s.id;
              const group = chipGroup({ label: `How ${name} is going`, value: s.level, options: LEVELS, onChange: (v) => (s.level = v), toneOf: (v) => (v === 1 ? "tone-drift" : v === 4 ? "tone-world" : "tone-focus") });
              const select = el("select", { "aria-label": `Last grade in ${name}` }, [el("option", { value: "", text: "Last grade" }), ...grades.map((g) => el("option", { value: g, text: g }))]);
              select.value = s.grade || "";
              select.addEventListener("change", () => {
                if (select.value) s.grade = select.value;
                else delete s.grade;
              });
              return el("div", { class: "setup-level" }, [el("b", { text: name }), group.node, select]);
            })
          ),
        ];
      },
    },
    {
      id: "aim",
      title: "What are you aiming for?",
      lead: "This sets how hard your plan pushes.",
      body: () => [choices(AIMS, () => a.aim, (id) => (a.aim = id))],
      ok: () => !!a.aim || "Choose an aim.",
    },
    {
      id: "school",
      title: "Your school day",
      lead: "Panalo plans around it, never over it.",
      body: () => {
        const days = new Set(a.schoolDays);
        return [
          el(
            "div",
            { class: "chips", role: "group", "aria-label": "School days" },
            DAYS.map((d) => {
              const b = el("button", { type: "button", class: "chip tone-time", "aria-pressed": String(days.has(d.id)), text: d.label });
              b.addEventListener("click", () => {
                if (days.has(d.id)) days.delete(d.id);
                else days.add(d.id);
                a.schoolDays = [...days];
                b.setAttribute("aria-pressed", String(days.has(d.id)));
              });
              return b;
            })
          ),
          el("div", { class: "setup-times" }, [
            el("label", { class: "field" }, [el("span", { text: "Starts" }), timeInput("setup-school-start", a.schoolStart, (v) => (a.schoolStart = v))]),
            el("label", { class: "field" }, [el("span", { text: "Ends" }), timeInput("setup-school-end", a.schoolEnd, (v) => (a.schoolEnd = v))]),
          ]),
        ];
      },
      ok: () => a.schoolEnd > a.schoolStart || "School has to end after it starts.",
    },
    {
      id: "boarding",
      title: "Boarder or day scholar?",
      lead: "Boarders get the evening prep hour; day scholars get their travel time back.",
      body: () => {
        const travel = chipGroup({
          label: "Travel each way",
          value: a.travelMinutes,
          options: [15, 30, 45, 60, 90].map((m) => ({ id: m, label: `${m} min` })),
          onChange: (v) => (a.travelMinutes = v),
          toneOf: () => "tone-time",
        });
        const travelBox = el("div", { class: "setup-sub", hidden: a.boarding }, [el("p", { class: "faint", text: "Travel to school, each way" }), travel.node]);
        return [
          choices(
            [
              { id: true, label: "Boarder", sub: "I live at school" },
              { id: false, label: "Day scholar", sub: "I travel to school" },
            ],
            () => a.boarding,
            (v) => {
              a.boarding = v;
              travelBox.hidden = v;
            }
          ),
          travelBox,
        ];
      },
    },
    {
      id: "sleep",
      title: "When do you wake and sleep?",
      lead: "Sleep is protected: Panalo never plans study into it.",
      body: () => [
        el("p", { class: "faint", text: "Wake up" }),
        chipGroup({ label: "Wake up", value: a.wakeAt, options: ["05:30", "06:00", "06:30", "07:00", "07:30"].map((t) => ({ id: t, label: t })), onChange: (v) => (a.wakeAt = v), toneOf: () => "tone-time" }).node,
        el("p", { class: "faint", text: "Go to sleep" }),
        chipGroup({ label: "Go to sleep", value: a.sleepAt, options: ["21:30", "22:00", "22:30", "23:00", "23:30"].map((t) => ({ id: t, label: t })), onChange: (v) => (a.sleepAt = v), toneOf: () => "tone-time" }).node,
      ],
    },
    {
      id: "tuition",
      title: "Tuition or coaching?",
      lead: "Hours a week outside school. Panalo counts them as study already done.",
      body: () => [
        chipGroup({
          label: "Tuition hours a week",
          value: a.tuitionHours,
          options: [0, 2, 4, 6, 8, 10].map((h) => ({ id: h, label: h ? (h === 10 ? "10+" : `${h} h`) : "None" })),
          onChange: (v) => (a.tuitionHours = v),
          toneOf: () => "tone-time",
        }).node,
      ],
    },
    {
      id: "exams",
      title: "Any exams or tests coming up?",
      lead: "Add the next few. Your plan builds towards them. You can skip this.",
      body: () => {
        const list = el("ul", { class: "setup-exams" });
        const draw = () =>
          list.replaceChildren(
            ...exams.map((x, i) =>
              el("li", {}, [
                el("span", { text: `${x.title} · ${new Date(x.date + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}` }),
                el("button", { type: "button", class: "link-btn", text: "Remove", onClick: () => (exams.splice(i, 1), draw()) }),
              ])
            )
          );
        const subjects = subjectsFor(a.stage).filter((s) => a.subjects.some((x) => x.id === s.id));
        const what = el("select", { id: "setup-exam-subject", "aria-label": "Subject" }, subjects.map((s) => el("option", { value: s.name, text: s.name })));
        const when = el("input", { type: "date", id: "setup-exam-date", "aria-label": "Date", min: new Date().toISOString().slice(0, 10) });
        const add = el("button", {
          type: "button",
          class: "btn btn-ghost btn-sm",
          text: "Add",
          onClick: () => {
            if (!when.value) return showToast("Choose the date first.", "");
            if (exams.length >= 12) return;
            exams.push({ title: `${what.value} test`, date: when.value });
            when.value = "";
            draw();
          },
        });
        draw();
        return [el("div", { class: "setup-exam-add" }, [what, when, add]), list];
      },
    },
  ];

  const live = () => steps.filter((s) => !s.skip?.());
  let at = 0;

  const render = () => {
    const list = live();
    const s = list[at];
    const back = el("button", { type: "button", class: "btn btn-quiet", text: at ? "Back" : editing ? "Cancel" : "" });
    back.hidden = !at && !editing;
    back.addEventListener("click", () => {
      if (at) {
        at--;
        render();
      } else close();
    });
    const last = at === list.length - 1;
    const next = el("button", { type: "submit", class: "btn btn-primary", text: last ? (editing ? "Save" : "Build my plan") : "Next" });
    form.replaceChildren(
      el("div", { class: "setup-steps", "aria-hidden": "true" }, list.map((_, i) => el("i", { class: i <= at ? "on" : "" }))),
      el("p", { class: "setup-count faint num", text: `${at + 1} of ${list.length}` }),
      el("h2", { id: "setup-title", text: s.title }),
      el("p", { class: "lead", text: s.lead }),
      ...s.body(),
      el("div", { class: "setup-actions" }, [back, next])
    );
    form.dataset.step = s.id;
    form.querySelector("button[role=radio], button.chip, input, select")?.focus();
  };

  let saving = false;
  async function finish() {
    if (saving) return;
    saving = true;
    const row = toRow(a);
    const { error } = await api.saveStudent(store.student ? row : { world_name: "My world", ...row });
    if (error) {
      saving = false;
      reportError(error, "Couldn't save your answers. Check your connection and try again.");
      return;
    }
    for (const x of exams) {
      const r = await api.addEvent({ title: x.title, kind: "exam", starts_at: new Date(x.date + "T09:00").toISOString() });
      if (r.error) reportError(r.error, "Your plan is saved, but an exam wasn't. Add it from Calendar.");
    }
    close();
  }

  function close() {
    root.hidden = true;
    document.body.classList.remove("in-setup");
    form.replaceChildren();
    onDone();
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    const s = live()[at];
    const verdict = s.ok ? s.ok() : true;
    if (verdict !== true) return showToast(verdict, "");
    if (at < live().length - 1) {
      at++;
      render();
    } else finish();
  };
  render();
}

