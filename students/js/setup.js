// The setup (v0.2): about 90 seconds, one question a screen, mostly one tap
// each. It asks what the planner needs -- board, year, subjects and how
// each is going, the aim, the school day, boarding or travel, sleep,
// tuition and any exams coming up -- and saves it to the study profile
// (phase 29). It replaces the old intro film.
import { stillSky } from "./sky.js";
import { el, chipGroup, showToast, reportError } from "./ui.js";
import { api, store } from "./store.js";
import { BOARDS, STAGES, AIMS, LEVELS, subjectsFor, gradesFor } from "./model/subjects.js";
import { toRow, fromRow, ACTIVITY_KINDS, cleanActivities } from "./model/profile.js";
import { clockOfText } from "./model/time.js";
import { art, artImg, onArt, GUARDIANS, guardianOf } from "./art.js";
import { createPan } from "./motion-art.js";

// Pan, beside each question: one short line, and how Pan looks saying it.
const PAN = {
  board: ["idle", "Hi, I'm Pan. A few quick questions and I'll plan your week."],
  stage: ["idle", "Which year? The syllabus changes with it."],
  subjects: ["cheer", "Every subject you pick gets a guardian."],
  levels: ["think", "Be honest. Weaker subjects get more time, not less."],
  aim: ["idle", "Aim high or steady: both are good plans."],
  school: ["think", "School comes first. I plan around it, never over it."],
  boarding: ["think", "Boarding or travelling: it changes your evenings."],
  sleep: ["idle", "Sleep is protected. I never plan into it."],
  tuition: ["think", "Sport, art, coaching: I plan around all of it."],
  exams: ["cheer", "Last one. Then your plan is ready."],
};

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
  stillSky(true);

  // The side: the painted wallpaper and Pan, with a line for each step.
  root.querySelector(".setup-side")?.remove();
  const panBox = el("div", { class: "setup-pan" });
  const panLine = el("p", { class: "setup-pan-line", "aria-hidden": "true" });
  const side = el("aside", { class: "setup-side", "aria-hidden": "true" }, [panBox, panLine]);
  root.prepend(side);
  root.classList.add("has-side");
  let panPose = null;
  let livePan = null;
  const showPan = (id) => {
    const [pose, line] = PAN[id] || PAN.board;
    panLine.textContent = line;
    if (pose === panPose && panBox.firstChild) return;
    panPose = pose;
    const img = artImg(`pan-${pose}`, { cls: "setup-pan-img" });
    if (img) panBox.replaceChildren(img);
    else {
      livePan ??= createPan({ size: 160, pose });
      livePan.setPose?.(pose);
      livePan.canvas.className = "setup-pan-img pan-live";
      panBox.replaceChildren(livePan.canvas);
    }
  };
  onArt(() => {
    const wall = art("wall-tall") || art("wall-wide");
    if (wall) side.style.setProperty("--setup-wall", `url("${new URL(wall, location.href).href}")`);
    side.classList.toggle("painted", !!wall);
    panPose = null;
    showPan(form.dataset.step);
  });

  const a = { ...fromRow(store.student) };
  if (!a.subjects.length) a.subjects = [];
  a.activities = cleanActivities(a.activities).map((x) => ({ ...x }));
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
      // Counted until a board is chosen, so the step count doesn't jump.
      skip: () => !!a.board && (STAGES[a.board] || []).length < 2,
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
              const b = el("button", { type: "button", class: "chip tone-focus", style: `--g:${GUARDIANS[guardianOf(s.id)]}`, "aria-pressed": String(chosen.has(s.id)) }, [
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
      lead: "A rough guess is fine: weaker subjects get more time, and short quick checks find out the rest. Your last grade is optional.",
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
      lead: "Boarders study in prep; day scholars lose their travel time. The plan fits either.",
      body: () => {
        const travel = chipGroup({
          label: "Travel each way",
          value: a.travelMinutes,
          options: [15, 30, 45, 60, 90].map((m) => ({ id: m, label: `${m} min` })),
          onChange: (v) => (a.travelMinutes = v),
          toneOf: () => "tone-time",
        });
        const travelBox = el("div", { class: "setup-sub", hidden: a.boarding }, [el("p", { class: "faint", text: "Travel to school, each way" }), travel.node]);
        const prepBox = el("div", { class: "setup-sub", hidden: !a.boarding }, [
          el("p", { class: "faint", text: "Evening prep on school days" }),
          el("div", { class: "setup-times" }, [
            el("label", { class: "field" }, [el("span", { text: "Starts" }), timeInput("setup-prep-start", a.prepStart || "18:00", (v) => (a.prepStart = v))]),
            el("label", { class: "field" }, [el("span", { text: "Ends" }), timeInput("setup-prep-end", a.prepEnd || "19:30", (v) => (a.prepEnd = v))]),
          ]),
        ]);
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
              prepBox.hidden = !v;
            }
          ),
          travelBox,
          prepBox,
        ];
      },
      ok: () => !a.boarding || (a.prepEnd || "19:30") > (a.prepStart || "18:00") || "Prep has to end after it starts.",
    },
    {
      id: "sleep",
      title: "When do you wake and sleep?",
      lead: "Sleep is protected: Panalo never plans study into it.",
      body: () => [
        el("p", { class: "faint", text: "Wake up" }),
        chipGroup({ label: "Wake up", value: a.wakeAt, options: ["05:30", "06:00", "06:30", "07:00", "07:30"].map((t) => ({ id: t, label: clockOfText(t) })), onChange: (v) => (a.wakeAt = v), toneOf: () => "tone-time" }).node,
        el("p", { class: "faint", text: "Go to sleep" }),
        chipGroup({ label: "Go to sleep", value: a.sleepAt, options: ["21:30", "22:00", "22:30", "23:00", "23:30"].map((t) => ({ id: t, label: clockOfText(t) })), onChange: (v) => (a.sleepAt = v), toneOf: () => "tone-time" }).node,
      ],
    },
    {
      id: "tuition",
      title: "The rest of your week",
      lead: "Sport, art, music, coaching: add what happens at set times, and your plan keeps those times free. Skip it if there's nothing.",
      body: () => {
        const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
        const list = el("div", { class: "setup-activities" });
        const draw = () => {
          list.replaceChildren(
            ...a.activities.map((x, i) =>
              el("div", { class: "setup-activity" }, [
                el("div", { class: "setup-activity-head" }, [
                  chipGroup({ label: "Kind", value: x.kind, options: ACTIVITY_KINDS.map(([id, label]) => ({ id, label })), onChange: (v) => (x.kind = v), toneOf: () => "tone-time" }).node,
                  el("button", { type: "button", class: "link-btn", text: "Remove", "aria-label": `Remove ${x.name || "this activity"}`, onClick: () => (a.activities.splice(i, 1), draw()) }),
                ]),
                (() => {
                  const name = el("input", { type: "text", class: "input", maxlength: "40", placeholder: "Name (optional), e.g. Football", value: x.name || "", "aria-label": "Name" });
                  name.addEventListener("input", () => (x.name = name.value));
                  return name;
                })(),
                el(
                  "div",
                  { class: "chips", role: "group", "aria-label": "Days" },
                  DAYS.map(([d, label]) => {
                    const b = el("button", { type: "button", class: "chip tone-time", "aria-pressed": String(x.days.includes(d)), text: label });
                    b.addEventListener("click", () => {
                      x.days = x.days.includes(d) ? x.days.filter((y) => y !== d) : [...x.days, d];
                      b.setAttribute("aria-pressed", String(x.days.includes(d)));
                    });
                    return b;
                  })
                ),
                el("div", { class: "setup-times" }, [
                  el("label", { class: "field" }, [el("span", { text: "From" }), timeInput(`setup-act-${i}-start`, x.start, (v) => (x.start = v))]),
                  el("label", { class: "field" }, [el("span", { text: "To" }), timeInput(`setup-act-${i}-end`, x.end, (v) => (x.end = v))]),
                ]),
              ])
            ),
            a.activities.length < 12
              ? el("button", { type: "button", class: "btn btn-ghost btn-sm", id: "setup-add-activity", text: a.activities.length ? "Add another" : "Add an activity", onClick: () => (a.activities.push({ kind: "sport", name: "", days: [], start: "17:00", end: "18:00" }), draw()) })
              : null
          );
        };
        draw();
        return [
          list,
          el("p", { class: "faint", text: "Coaching without fixed times? Hours a week:" }),
          chipGroup({
            label: "Coaching hours a week without fixed times",
            value: a.tuitionHours,
            options: [0, 2, 4, 6, 8, 10].map((h) => ({ id: h, label: h ? (h === 10 ? "10+" : `${h} h`) : "None" })),
            onChange: (v) => (a.tuitionHours = v),
            toneOf: () => "tone-time",
          }).node,
        ];
      },
      ok: () => {
        const bad = a.activities.find((x) => !x.days.length || !x.start || !x.end || x.end <= x.start);
        if (!bad) return true;
        return !bad.days.length ? `Pick the days for ${bad.name || "each activity"}.` : `${bad.name || "An activity"} has to end after it starts.`;
      },
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
      el("div", { class: "setup-steps", "aria-hidden": "true" }, list.map((_, i) => el("i", { class: i < at ? "on" : i === at ? "on now" : "" }))),
      el("p", { class: "setup-count faint num" }, [el("span", { class: "setup-num", "aria-hidden": "true", text: String(at + 1).padStart(2, "0") }), el("span", { text: `${at + 1} of ${list.length}` })]),
      el("h2", { id: "setup-title", text: s.title }),
      el("p", { class: "lead", text: s.lead }),
      ...s.body(),
      el("div", { class: "setup-actions" }, [back, next])
    );
    form.dataset.step = s.id;
    showPan(s.id);
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
    side.remove();
    root.classList.remove("has-side");
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

