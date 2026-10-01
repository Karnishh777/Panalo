// The Study Room: deep space at midnight.
//
// Deliberately the quietest place in the app. One ring, one number, what
// you're working on, and a short list of tasks. Everything else -- presets,
// sound, history -- sits low and dim until you reach for it. "Go dark"
// removes even that, and the top bar with it.
//
// The timer is timestamps, not ticks (model/focus-timer.js): it survives a
// reload, a closed lid and navigating away. Finished blocks are recorded as
// focus sessions -- the thing that grows the land on your world.
import { el, showToast, getPrefs, setPrefs, reportError, shortDate } from "../ui.js";
import { store, on, api } from "../store.js";
import * as T from "../model/focus-timer.js";
import { loadTimer, saveTimer, onTimer, settleTimer } from "../timer-state.js";
import { SOUNDS, playAmbient, setVolume, chime, currentSound } from "../ambient.js";
import { startOfDay, startOfWeek, addDays, formatMinutes, clockTime, DAY, relTime } from "../model/time.js";

let root;
let timer = T.idle();
let tick = null;
let ring;
let readout;
let phaseEl;
let controls;
let subjectInput;
let taskSelect;
let tasksEl;
let historyEl;
let noticeEl;
let unsubs = [];
let navigate;
let lastTitle = "";

const R = 118;
const CIRC = 2 * Math.PI * R;

function prefs() {
  const p = getPrefs();
  return { preset: p.studyPreset || "25", custom: p.studyCustom || 40, sound: p.studySound || "off", volume: p.studyVolume ?? 0.5 };
}

function planFor(phase) {
  const p = prefs();
  if (p.preset === "custom") return phase === "focus" ? p.custom : Math.max(5, Math.round(p.custom / 5));
  const preset = T.PRESETS.find((x) => x.id === p.preset) || T.PRESETS[0];
  return phase === "focus" ? preset.focus : preset.rest;
}

function svgRing() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 260 260");
  svg.setAttribute("class", "study-ring");
  svg.setAttribute("aria-hidden", "true");
  const track = document.createElementNS(NS, "circle");
  track.setAttribute("cx", "130");
  track.setAttribute("cy", "130");
  track.setAttribute("r", R);
  track.setAttribute("class", "ring-track");
  const arc = document.createElementNS(NS, "circle");
  arc.setAttribute("cx", "130");
  arc.setAttribute("cy", "130");
  arc.setAttribute("r", R);
  arc.setAttribute("class", "ring-arc");
  arc.setAttribute("stroke-dasharray", CIRC);
  arc.setAttribute("stroke-dashoffset", CIRC);
  const body = document.createElementNS(NS, "circle");
  body.setAttribute("r", "4.5");
  body.setAttribute("class", "ring-body");
  svg.append(track, arc, body);
  return { svg, arc, body };
}

function draw() {
  const now = Date.now();
  const running = timer.phase !== "idle";
  const left = running ? T.remaining(timer, now) : planFor("focus") * 60000;
  const prog = running ? T.progress(timer, now) : 0;
  readout.textContent = T.readout(left);
  ring.arc.setAttribute("stroke-dashoffset", String(CIRC * (1 - prog)));
  const a = prog * Math.PI * 2 - Math.PI / 2;
  ring.body.setAttribute("cx", String(130 + Math.cos(a) * R));
  ring.body.setAttribute("cy", String(130 + Math.sin(a) * R));
  root.dataset.phase = timer.phase;
  root.dataset.status = running ? timer.status : "idle";
  phaseEl.textContent = !running ? "Ready when you are" : timer.phase === "focus" ? (timer.status === "paused" ? "Paused" : "Focus") : timer.status === "paused" ? "Rest, paused" : "Rest";
  if (running && document.body.dataset.view === "study") {
    const t = `${T.readout(left)} · ${timer.phase === "focus" ? "Focus" : "Rest"}`;
    if (t !== lastTitle) document.title = lastTitle = t;
  }
  if (running && T.isDone(timer, now)) finish();
}

function renderControls() {
  const running = timer.phase !== "idle";
  const b = (label, kind, fn, attrs = {}) => el("button", { type: "button", class: `btn ${kind}`, text: label, onClick: fn, ...attrs });
  if (!running) {
    controls.replaceChildren(b("Begin focus", "btn-primary btn-lg", () => begin("focus"), { id: "study-start" }), b("Take a rest", "btn-quiet", () => begin("rest")));
  } else if (timer.status === "running") {
    controls.replaceChildren(b("Pause", "btn-ghost btn-lg", () => update(T.pause(timer, Date.now())), { id: "study-pause" }), b(timer.phase === "focus" ? "End early" : "Skip rest", "btn-quiet", endEarly));
  } else {
    controls.replaceChildren(b("Resume", "btn-primary btn-lg", () => update(T.resume(timer, Date.now()))), b(timer.phase === "focus" ? "End and keep the time" : "Skip rest", "btn-quiet", endEarly));
  }
  subjectInput.disabled = running;
  taskSelect.disabled = running;
}

function update(next) {
  timer = next;
  saveTimer(timer);
  renderControls();
  draw();
}

function begin(phase) {
  playAmbientFromPrefs();
  const taskId = taskSelect.value || null;
  const task = taskId && store.tasks.find((t) => t.id === taskId);
  const subject = subjectInput.value.trim() || task?.subject || null;
  update(T.start(phase, planFor(phase), Date.now(), { subject, taskId }));
  noticeEl.replaceChildren();
}

async function endEarly() {
  const now = Date.now();
  if (timer.phase === "focus") {
    const row = T.sessionRow(timer, now);
    if (row) {
      const { error } = await api.addSession(row);
      if (error) return reportError(error, "Couldn't save the session.");
      showToast(`${formatMinutes(row.focused_minutes)} of focus recorded.`, "success");
    } else showToast("Under a minute — nothing recorded.", "");
  }
  update(T.idle());
}

let finishing = false;
async function finish() {
  if (finishing) return;
  finishing = true;
  try {
    await finishOnce();
  } finally {
    finishing = false;
  }
}

async function finishOnce() {
  const was = timer;
  if (was.phase === "focus") {
    const r = await settleTimer();
    if (r?.error) return reportError(r.error, "Couldn't save the session.");
  }
  chime();
  notify(was.phase === "focus" ? "Focus block done. Time to rest." : "Rest's over. Ready when you are.");
  timer = T.idle();
  saveTimer(timer);
  renderControls();
  draw();
  if (was.phase === "focus") {
    noticeEl.replaceChildren(
      el("p", { class: "study-notice-text" }, [el("b", { text: `${formatMinutes(Math.round(was.plannedMs / 60000))} of focus — added to your world.` }), " Rest your eyes for a few minutes."]),
      el("div", { class: "chips" }, [
        el("button", { type: "button", class: "btn btn-primary btn-sm", text: `Rest ${planFor("rest")} min`, onClick: () => begin("rest") }),
        el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "See my world", onClick: () => navigate("world") }),
      ])
    );
  }
}

function notify(text) {
  try {
    if (document.hidden && "Notification" in window && Notification.permission === "granted" && getPrefs().studyNotify) {
      new Notification("Panalo Study Room", { body: text, tag: "panalo-study", silent: true });
    }
  } catch {
    /* notifications are a nicety */
  }
}

function playAmbientFromPrefs() {
  const p = prefs();
  if (p.sound !== "off" && currentSound() !== p.sound) {
    playAmbient(p.sound);
    setVolume(p.volume);
  }
}

// ---- tasks ---------------------------------------------------------------------

function renderTasks() {
  const open = store.tasks.filter((t) => !t.done_at);
  const doneToday = store.tasks.filter((t) => t.done_at && Date.parse(t.done_at) >= startOfDay(Date.now()).getTime());
  const prev = taskSelect.value;
  taskSelect.replaceChildren(el("option", { value: "", text: "No particular task" }), ...open.map((t) => el("option", { value: t.id, text: t.title })));
  if (open.some((t) => t.id === prev)) taskSelect.value = prev;
  else if (timer.taskId && open.some((t) => t.id === timer.taskId)) taskSelect.value = timer.taskId;

  const item = (t) => {
    const box = el("input", { type: "checkbox", "aria-label": `Done: ${t.title}` });
    box.checked = !!t.done_at;
    box.addEventListener("change", async () => {
      const { error } = await api.toggleTask(t);
      if (error) {
        box.checked = !box.checked;
        reportError(error);
      }
    });
    const due = t.due_at && !t.done_at ? el("span", { class: `task-due${Date.parse(t.due_at) < Date.now() ? " late" : ""}`, text: Date.parse(t.due_at) < Date.now() ? `was due ${relTime(Date.parse(t.due_at))}` : `due ${shortDate(t.due_at)}` }) : null;
    return el("li", { class: t.done_at ? "done" : "" }, [
      el("label", { class: "task" }, [box, el("span", { class: "task-title", text: t.title }), t.subject ? el("span", { class: "tag tone-focus", text: t.subject }) : null, due]),
      el("button", {
        type: "button",
        class: "icon-btn sm task-x",
        "aria-label": `Delete task: ${t.title}`,
        text: "✕",
        onClick: async () => {
          const { error } = await api.deleteTask(t.id);
          if (error) reportError(error);
        },
      }),
    ]);
  };
  tasksEl.replaceChildren(
    ...(open.length || doneToday.length
      ? [el("ul", { class: "task-list" }, open.map(item)), doneToday.length ? el("ul", { class: "task-list done-list", "aria-label": "Done today" }, doneToday.map(item)) : null]
      : [el("p", { class: "faint task-empty", text: "Nothing on the list. Add the one thing you're here to do." })])
  );
}

function taskForm() {
  const title = el("input", { type: "text", class: "input", placeholder: "Add a task…", maxlength: "200", "aria-label": "New task" });
  const due = el("input", { type: "date", class: "input task-date", "aria-label": "Due date (optional)" });
  const form = el("form", { class: "task-form", novalidate: "" }, [title, due, el("button", { type: "submit", class: "btn btn-ghost btn-sm", text: "Add" })]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = title.value.trim();
    if (!t) return title.focus();
    const row = { title: t };
    const subj = subjectInput.value.trim();
    if (subj) row.subject = subj.slice(0, 40);
    if (due.value) {
      const d = new Date(`${due.value}T23:59`);
      row.due_at = d.toISOString();
    }
    const { error } = await api.addTask(row);
    if (error) return reportError(error, "Couldn't add that task.");
    title.value = "";
    due.value = "";
    title.focus();
  });
  return { form, title };
}

// ---- history ------------------------------------------------------------------

function renderHistory() {
  const today = startOfDay(Date.now()).getTime();
  const days = Array.from({ length: 7 }, (_, i) => addDays(new Date(today), i - 6));
  const minutes = days.map((d) => store.sessions.filter((s) => Date.parse(s.started_at) >= d.getTime() && Date.parse(s.started_at) < d.getTime() + DAY).reduce((n, s) => n + s.focused_minutes, 0));
  const max = Math.max(60, ...minutes);
  const week = store.sessions.filter((s) => Date.parse(s.started_at) >= startOfWeek(Date.now()).getTime()).reduce((n, s) => n + s.focused_minutes, 0);
  const todays = store.sessions.filter((s) => Date.parse(s.started_at) >= today);
  historyEl.replaceChildren(
    el("div", { class: "hist-bars", role: "img", "aria-label": `Focus over the last seven days: ${days.map((d, i) => `${d.toLocaleDateString(undefined, { weekday: "short" })} ${minutes[i]} minutes`).join(", ")}` },
      days.map((d, i) =>
        el("div", { class: `hist-bar${i === 6 ? " today" : ""}` }, [
          el("i", { style: `height:${Math.max(3, (minutes[i] / max) * 56)}px` }),
          el("span", { text: d.toLocaleDateString(undefined, { weekday: "narrow" }) }),
        ])
      )
    ),
    el("p", { class: "hist-sum" }, [el("b", { class: "num", text: formatMinutes(week) }), " this week · ", el("span", { class: "num", text: formatMinutes(minutes[6]) }), " today"]),
    todays.length
      ? el("ul", { class: "log hist-log" }, todays.map((s) => el("li", {}, [el("span", { class: "t", text: clockTime(s.started_at) }), el("span", { text: `${formatMinutes(s.focused_minutes)}${s.subject ? ` · ${s.subject}` : ""}${s.completed ? "" : " · ended early"}` })])))
      : el("p", { class: "faint", text: "No sessions yet today." })
  );
}

// ---- mount ---------------------------------------------------------------------

export function mount(section, ctx) {
  navigate = ctx.navigate;
  root = el("div", { class: "study" });
  ring = svgRing();
  readout = el("div", { class: "study-readout num", "aria-live": "off" });
  phaseEl = el("p", { class: "study-phase", "aria-live": "polite" });
  controls = el("div", { class: "study-controls" });
  noticeEl = el("div", { class: "study-notice", role: "status" });
  const pastSubjects = [...new Set(store.sessions.map((s) => s.subject).filter(Boolean))].slice(0, 20);
  subjectInput = el("input", { type: "text", class: "input study-subject", placeholder: "What are you working on?", maxlength: "40", list: "study-subjects", "aria-label": "Subject" });
  taskSelect = el("select", { class: "input study-task", "aria-label": "Task" });
  const p = prefs();

  const presetGroup = el("div", { class: "chips", role: "radiogroup", "aria-label": "Session length" });
  const customInput = el("input", { type: "number", class: "input preset-custom", min: "5", max: "240", value: String(p.custom), "aria-label": "Custom minutes" });
  const drawPresets = () => {
    const cur = prefs().preset;
    presetGroup.replaceChildren(
      ...T.PRESETS.map((x) => el("button", { type: "button", role: "radio", class: "chip tone-focus", "aria-checked": String(cur === x.id), text: x.label, onClick: () => { setPrefs({ studyPreset: x.id }); drawPresets(); draw(); } })),
      el("button", { type: "button", role: "radio", class: "chip tone-focus", "aria-checked": String(cur === "custom"), text: "Custom", onClick: () => { setPrefs({ studyPreset: "custom" }); drawPresets(); draw(); customInput.focus(); } }),
      ...(cur === "custom" ? [customInput] : [])
    );
  };
  customInput.addEventListener("change", () => {
    const v = Math.max(5, Math.min(240, Math.round(Number(customInput.value) || 40)));
    customInput.value = String(v);
    setPrefs({ studyCustom: v });
    draw();
  });
  drawPresets();

  const sound = el("select", { class: "input", "aria-label": "Ambient sound" }, SOUNDS.map((s) => el("option", { value: s.id, text: s.label })));
  sound.value = p.sound;
  sound.addEventListener("change", () => {
    setPrefs({ studySound: sound.value });
    playAmbient(sound.value);
    setVolume(prefs().volume);
  });
  const volume = el("input", { type: "range", class: "range tone-focus", min: "0", max: "1", step: "0.05", value: String(p.volume), "aria-label": "Volume" });
  volume.addEventListener("input", () => {
    setPrefs({ studyVolume: Number(volume.value) });
    setVolume(Number(volume.value));
  });

  const dark = el("button", { type: "button", class: "btn btn-quiet btn-sm study-dark", text: "Go dark", "aria-pressed": "false" });
  const setDark = (on) => {
    document.body.classList.toggle("midnight", on);
    dark.setAttribute("aria-pressed", String(on));
    dark.textContent = on ? "Come back" : "Go dark";
  };
  dark.addEventListener("click", () => setDark(!document.body.classList.contains("midnight")));
  const esc = (e) => e.key === "Escape" && document.body.classList.contains("midnight") && setDark(false);
  document.addEventListener("keydown", esc);
  unsubs.push(() => document.removeEventListener("keydown", esc), () => setDark(false));

  tasksEl = el("div", { class: "study-tasks-list" });
  historyEl = el("div", { class: "study-history" });
  const { form } = taskForm();

  root.append(
    el("div", { class: "study-top" }, [el("p", { class: "kicker toned tone-focus", text: "Study Room" }), dark]),
    el("div", { class: "study-center" }, [
      el("div", { class: "study-dial" }, [ring.svg, el("div", { class: "study-dial-text" }, [readout, phaseEl])]),
      el("div", { class: "study-what" }, [subjectInput, el("datalist", { id: "study-subjects" }, pastSubjects.map((s) => el("option", { value: s }))), taskSelect]),
      controls,
      noticeEl,
    ]),
    el("div", { class: "study-low" }, [
      el("section", { class: "study-panel", "aria-labelledby": "st-tasks" }, [el("h2", { id: "st-tasks", text: "Tasks" }), form, tasksEl]),
      el("section", { class: "study-panel", "aria-labelledby": "st-set" }, [
        el("h2", { id: "st-set", text: "Length and sound" }),
        presetGroup,
        el("div", { class: "sound-row" }, [sound, volume]),
        el("p", { class: "faint small", text: "Sounds are generated on your device. Nothing to download." }),
      ]),
      el("section", { class: "study-panel", "aria-labelledby": "st-hist" }, [el("h2", { id: "st-hist", text: "Your sessions" }), historyEl]),
    ])
  );
  section.append(root);

  timer = loadTimer();
  if (timer.subject) subjectInput.value = timer.subject;
  renderTasks();
  renderHistory();
  renderControls();
  draw();
  unsubs.push(
    on("tasks", renderTasks),
    on("sessions", renderHistory),
    onTimer(() => {
      timer = loadTimer();
      renderControls();
      draw();
    })
  );
}

export function show(param) {
  // Reconcile anything that finished while we were away.
  settleTimer().then((r) => r?.minutes && showToast(`A ${formatMinutes(r.minutes)} session finished while you were away — recorded.`, "success"));
  timer = loadTimer();
  if (timer.phase === "focus" && T.isDone(timer, Date.now())) {
    timer = T.idle();
    saveTimer(timer);
  }
  renderControls();
  draw();
  clearInterval(tick);
  tick = setInterval(() => !document.hidden && draw(), 250);
  if (param === "start-25") {
    setPrefs({ studyPreset: "25" });
    if (timer.phase === "idle") begin("focus");
  } else if (param === "add-task") {
    root.querySelector(".task-form input")?.focus();
  }
  if (!store.tasks.length && !store.sessions.length && param !== "add-task") {
    noticeEl.replaceChildren(el("p", { class: "faint", text: "First time here? Name what you're working on, press Begin, and leave everything else alone. The ring fills as you focus." }));
  }
}

export function hide() {
  clearInterval(tick);
  tick = null;
  document.body.classList.remove("midnight");
  lastTitle = "";
}

export function destroy() {
  hide();
  unsubs.forEach((u) => u());
  unsubs = [];
  playAmbient("off");
}

