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
import { el, showToast, getPrefs, setPrefs, reportError, shortDate, openSheet, field } from "../ui.js";
import { store, on, api } from "../store.js";
import * as T from "../model/focus-timer.js";
import { loadTimer, saveTimer, onTimer, settleTimer, recordSession } from "../timer-state.js";
import { SOUNDS, playAmbient, setVolume, chime, currentSound } from "../ambient.js";
import { startOfDay, startOfWeek, addDays, formatMinutes, clockTime, DAY, relTime, dayKey } from "../model/time.js";
import { openBlockCheck } from "../block-check.js";
import { loadBanks, nameOf, topicName, colourOf } from "../planner.js";
import { KINDS } from "../model/plan.js";

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
let blockEl;
let unsubs = [];
let navigate;
let lastTitle = "";
let subjectFilter = ""; // the task list, narrowed to one subject ("" = all)

const R = 118;
const CIRC = 2 * Math.PI * R;

function prefs() {
  const p = getPrefs();
  return { preset: p.studyPreset || "25", custom: p.studyCustom || 40, sound: p.studySound || "off", volume: p.studyVolume ?? 0.5 };
}

// A plan for today: how many focus blocks (prefs, so it follows you).
function plan() {
  const p = getPrefs().studyPlan;
  return p && p.day === dayKey(new Date()) && p.total > 0 ? p : null;
}
function setPlan(total) {
  setPrefs({ studyPlan: total ? { day: dayKey(new Date()), total, done: plan()?.done || 0 } : null });
}
function planStep() {
  const p = plan();
  if (p) setPrefs({ studyPlan: { ...p, done: Math.min(p.total, p.done + 1) } });
  return plan();
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
  const pl = plan();
  const blockOf = pl ? ` · block ${Math.min(pl.total, pl.done + (timer.phase === "focus" ? 1 : 0))} of ${pl.total}` : "";
  phaseEl.textContent = (!running ? (pl ? (pl.done >= pl.total ? `All ${pl.total} blocks done today` : `Block ${pl.done + 1} of ${pl.total} next`) : "Ready when you are") : timer.phase === "focus" ? (timer.status === "paused" ? "Paused" : "Focus") : timer.status === "paused" ? "Rest, paused" : "Rest") + (running ? blockOf : "");
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
  if (blockEl) renderBlock();
}

function update(next) {
  timer = next;
  saveTimer(timer);
  renderControls();
  draw();
}

function begin(phase, { keepNotice = false, block = null } = {}) {
  playAmbientFromPrefs();
  const taskId = block ? null : taskSelect.value || null;
  const task = taskId && store.tasks.find((t) => t.id === taskId);
  const subject = subjectInput.value.trim() || task?.subject || null;
  const minutes = block && phase === "focus" ? block.minutes : planFor(phase);
  update(T.start(phase, minutes, Date.now(), { subject, taskId, block: phase === "focus" ? block : null }));
  if (!keepNotice) noticeEl.replaceChildren();
}

// A planned block (v0.2): what it is, above the controls.
function renderBlock() {
  const b = timer.phase === "focus" ? timer.block : null;
  blockEl.hidden = !b;
  if (!b) return blockEl.replaceChildren();
  blockEl.style.setProperty("--subj", colourOf(b.subject));
  blockEl.replaceChildren(el("span", { class: "sb-kind", text: KINDS[b.kind]?.label || "" }), el("b", { text: topicName(b.subject, b.topic) }), el("span", { class: "faint", text: KINDS[b.kind]?.verb || "" }));
}

// The latest session saved for this block, so its check can note coverage.
function sessionFor(t) {
  const start = new Date(t.startedAt).toISOString();
  return store.sessions.find((s) => s.started_at === start) || null;
}

async function endEarly() {
  const now = Date.now();
  if (timer.phase === "focus") {
    const row = T.sessionRow(timer, now);
    if (row) {
      const { error, transient } = await recordSession(row);
      if (error && transient) return reportError(error, "You're offline — the session wasn't saved yet. Try again.");
      if (error) {
        reportError(error, "That session couldn't be saved.");
        return update(T.idle());
      }
      showToast(`${formatMinutes(row.focused_minutes)} of focus recorded.`, "success");
      // Ended a planned block early but worked on it: still check it.
      if (timer.block && row.focused_minutes >= 5) {
        const was = timer;
        update(T.idle());
        return openBlockCheck(was.block, { minutes: row.focused_minutes, sessionId: sessionFor(was)?.id });
      }
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
  if (was.phase === "focus" && was.block) {
    // A planned block: its check, then the plan moves on by itself.
    noticeEl.replaceChildren(el("p", { class: "study-notice-text" }, [el("b", { text: `${formatMinutes(Math.round(was.plannedMs / 60000))} on ${topicName(was.block.subject, was.block.topic)} — added to your world.` })]));
    openBlockCheck(was.block, { minutes: Math.round(was.plannedMs / 60000), sessionId: sessionFor(was)?.id });
    return;
  }
  if (was.phase === "focus") {
    const p = planStep();
    const more = p && p.done < p.total;
    const allDone = p && p.done >= p.total;
    noticeEl.replaceChildren(
      el("p", { class: "study-notice-text" }, [
        el("b", { text: `${formatMinutes(Math.round(was.plannedMs / 60000))} of focus — added to your world.` }),
        p ? ` Block ${p.done} of ${p.total}.` : "",
        allDone ? " That's the plan, kept." : " Rest your eyes for a few minutes.",
      ]),
      reflection(),
      el("div", { class: "chips" }, [
        more ? null : el("button", { type: "button", class: "btn btn-primary btn-sm", text: `Rest ${planFor("rest")} min`, onClick: () => begin("rest") }),
        el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "See my world", onClick: () => navigate("world") }),
      ])
    );
    // With blocks still to go, the rest starts by itself.
    if (more) begin("rest", { keepNotice: true });
  } else if (was.phase === "rest") {
    const p = plan();
    if (p && p.done < p.total) {
      noticeEl.replaceChildren(
        el("p", { class: "study-notice-text" }, [el("b", { text: `Rest's over. Block ${p.done + 1} of ${p.total}.` })]),
        el("div", { class: "chips" }, [el("button", { type: "button", class: "btn btn-primary btn-sm", id: "study-next-block", text: `Begin block ${p.done + 1}`, onClick: () => begin("focus") })])
      );
    }
  }
}

// How deep was it? Saved on the block just recorded (phase 26); optional.
function reflection() {
  const latest = store.sessions.slice().sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
  if (!latest) return null;
  const box = el("div", { class: "reflect" }, [el("span", { class: "faint", text: "How deep was it?" })]);
  const chips = el("div", { class: "chips", role: "radiogroup", "aria-label": "How deep was it?" });
  const draw = (cur) =>
    chips.replaceChildren(
      ...[[1, "Scattered"], [2, "Okay"], [3, "Deep"]].map(([v, label]) =>
        el("button", {
          type: "button",
          role: "radio",
          class: "chip tone-focus",
          "aria-checked": String(cur === v),
          "data-quality": String(v),
          text: label,
          onClick: async () => {
            draw(v);
            const { error } = await api.updateSession(latest.id, { quality: v });
            if (error) reportError(error, "Couldn't save that.");
          },
        })
      )
    );
  draw(latest.quality || null);
  box.append(chips);
  return box;
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

// The list's own settings (synced with your preferences): your order or
// by due date, and numbers, bullets or nothing in front of each task.
const taskPrefs = () => {
  const p = getPrefs();
  return { sort: p.taskSort === "due" ? "due" : "mine", marks: ["numbers", "bullets", "none"].includes(p.taskMarks) ? p.taskMarks : "numbers", order: Array.isArray(p.taskOrder) ? p.taskOrder : [] };
};

function inYourOrder(tasks, order) {
  const at = new Map(order.map((id, i) => [id, i]));
  // Tasks you haven't placed yet go to the end, oldest first.
  return [...tasks].sort((a, b) => {
    const ia = at.has(a.id) ? at.get(a.id) : Infinity;
    const ib = at.has(b.id) ? at.get(b.id) : Infinity;
    if (ia !== ib) return ia - ib;
    return Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0);
  });
}

function saveOrder(ids) {
  const open = new Set(store.tasks.filter((t) => !t.done_at).map((t) => t.id));
  setPrefs({ taskOrder: ids.filter((id) => open.has(id)) });
}

function renderTasks() {
  const open = store.tasks.filter((t) => !t.done_at);
  const doneToday = store.tasks.filter((t) => t.done_at && Date.parse(t.done_at) >= startOfDay(Date.now()).getTime());
  const prev = taskSelect.value;
  const tp = taskPrefs();
  const ordered = tp.sort === "due"
    ? [...open].sort((a, b) => (a.due_at && b.due_at ? Date.parse(a.due_at) - Date.parse(b.due_at) : a.due_at ? -1 : b.due_at ? 1 : 0))
    : inYourOrder(open, tp.order);
  taskSelect.replaceChildren(el("option", { value: "", text: "No particular task" }), ...ordered.map((t) => el("option", { value: t.id, text: t.title })));
  if (open.some((t) => t.id === prev)) taskSelect.value = prev;
  else if (timer.taskId && open.some((t) => t.id === timer.taskId)) taskSelect.value = timer.taskId;

  // With tasks in more than one subject, a row of subjects narrows the list.
  const subjects = [...new Set(open.map((t) => (t.subject || "").trim()).filter(Boolean))].sort();
  if (subjectFilter && !subjects.includes(subjectFilter)) subjectFilter = "";
  const shown = ordered.filter((t) => !subjectFilter || (t.subject || "").trim() === subjectFilter);
  // Reordering by hand: only in your own order, with the whole list showing.
  const canMove = tp.sort === "mine" && !subjectFilter && shown.length > 1;

  const item = (t, i) => {
    const box = el("input", { type: "checkbox", "aria-label": `Done: ${t.title}` });
    box.checked = !!t.done_at;
    box.addEventListener("change", async () => {
      const { error } = await api.toggleTask(t);
      if (error) {
        box.checked = !box.checked;
        reportError(error);
      }
    });
    const late = t.due_at && Date.parse(t.due_at) < Date.now();
    const due = t.due_at && !t.done_at ? el("span", { class: `task-due${late ? " late" : ""}`, text: late ? `was due ${relTime(Date.parse(t.due_at))}` : `due ${shortDate(t.due_at)}` }) : null;
    const done = !!t.done_at;
    return el("li", { class: done ? "done" : "", "data-id": t.id }, [
      !done && canMove ? el("button", { type: "button", class: "task-grip", "aria-label": `Move ${t.title}: use the up and down arrow keys`, title: "Drag to reorder", text: "⠿" }) : null,
      !done && tp.marks !== "none" ? el("span", { class: "task-mark num", "aria-hidden": "true", text: tp.marks === "numbers" ? `${i + 1}.` : "•" }) : null,
      el("label", { class: "task" }, [box, el("span", { class: "task-title", text: t.title }), t.subject ? el("span", { class: "tag tone-focus", text: t.subject }) : null, due]),
      done ? null : el("button", { type: "button", class: "icon-btn sm task-edit", "aria-label": `Edit task: ${t.title}`, title: "Edit", text: "✎", onClick: () => editTask(t) }),
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

  // The list's tools: order and markers.
  const seg = (label, key, options, cur) =>
    el("div", { class: "seg", role: "radiogroup", "aria-label": label },
      options.map(([v, text, name]) => el("button", { type: "button", role: "radio", class: "seg-btn", "aria-checked": String(cur === v), "aria-label": name, title: name, text, onClick: () => { setPrefs({ [key]: v }); renderTasks(); } })));
  const tools = open.length
    ? el("div", { class: "task-tools" }, [
        seg("Order", "taskSort", [["mine", "My order", "Your order"], ["due", "By due", "By due date"]], tp.sort),
        seg("List style", "taskMarks", [["numbers", "1.", "Numbered"], ["bullets", "•", "Bulleted"], ["none", "—", "No markers"]], tp.marks),
      ])
    : null;
  const filter = subjects.length > 1
    ? el("div", { class: "chips task-filter", role: "radiogroup", "aria-label": "Show tasks for" },
        ["", ...subjects].map((s) => el("button", { type: "button", role: "radio", class: "chip tone-focus", "aria-checked": String(subjectFilter === s), text: s || "All", onClick: () => { subjectFilter = s; renderTasks(); } })))
    : null;
  const list = el(tp.marks === "numbers" ? "ol" : "ul", { class: `task-list marks-${tp.marks}${canMove ? " movable" : ""}` }, shown.map(item));
  if (canMove) sortable(list);

  // (Filtered: replaceChildren would print a null as the word "null".)
  tasksEl.replaceChildren(
    ...(open.length || doneToday.length
      ? [tools, filter, open.length ? list : null, doneToday.length ? el("ul", { class: "task-list done-list", "aria-label": "Done today" }, doneToday.map(item)) : null]
      : [el("p", { class: "faint task-empty", text: "Nothing on the list. Add the one thing you're here to do." })]
    ).filter(Boolean)
  );
}

// Drag a task by its grip (mouse, pen or finger), or move it with the arrow
// keys on the grip. The list renumbers as it moves; the order is saved.
function sortable(list) {
  const renumber = () => list.querySelectorAll(":scope > li .task-mark").forEach((m, i) => { if (m.textContent !== "•") m.textContent = `${i + 1}.`; });
  const ids = () => [...list.querySelectorAll(":scope > li")].map((li) => li.dataset.id);
  const mid = (n) => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; };
  list.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".task-grip");
    if (!grip || e.button > 0) return;
    e.preventDefault();
    const li = grip.closest("li");
    const before = ids().join();
    const pid = e.pointerId;
    // Listened for on the window: moving the row in the page would drop a
    // pointer capture on the grip.
    li.classList.add("dragging");
    list.classList.add("sorting");
    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      let sib;
      let moved = false;
      while ((sib = li.previousElementSibling) && ev.clientY < mid(sib)) (list.insertBefore(li, sib), (moved = true));
      while ((sib = li.nextElementSibling) && ev.clientY > mid(sib)) (list.insertBefore(sib, li), (moved = true));
      if (moved) renumber();
    };
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      li.classList.remove("dragging");
      list.classList.remove("sorting");
      if (ids().join() !== before) {
        saveOrder(ids());
        renderTasks();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
  list.addEventListener("keydown", (e) => {
    const grip = e.target.closest(".task-grip");
    if (!grip || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const li = grip.closest("li");
    const sib = e.key === "ArrowUp" ? li.previousElementSibling : li.nextElementSibling;
    if (!sib) return;
    if (e.key === "ArrowUp") list.insertBefore(li, sib);
    else list.insertBefore(sib, li);
    const id = li.dataset.id;
    saveOrder(ids());
    renderTasks();
    tasksEl.querySelector(`li[data-id="${CSS.escape(id)}"] .task-grip`)?.focus();
  });
}

// Change a task's name, subject or due date.
function editTask(t) {
  const title = el("input", { type: "text", maxlength: "200", value: t.title });
  const subject = el("input", { type: "text", maxlength: "40", value: t.subject || "", list: "study-subjects" });
  const due = el("input", { type: "date", value: t.due_at ? dayKey(new Date(t.due_at)) : "" });
  openSheet({
    title: "Edit task",
    body: [field("Task", title), field("Subject", subject, "Optional"), field("Due", due, "Optional — leave empty for no date")],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Save",
        kind: "btn-primary",
        submit: true,
        onClick: async () => {
          const v = title.value.trim();
          if (!v) return showToast("A task needs a name."), false;
          const patch = { title: v.slice(0, 200), subject: subject.value.trim().slice(0, 40) || null, due_at: due.value ? new Date(`${due.value}T23:59`).toISOString() : null };
          const { error } = await api.updateTask(t.id, patch);
          if (error) return reportError(error, "Couldn't save that task."), false;
        },
      },
    ],
  });
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
  // This week, by subject.
  const bySubject = new Map();
  for (const s of store.sessions) {
    if (Date.parse(s.started_at) < startOfWeek(Date.now()).getTime()) continue;
    const k = (s.subject || "").trim() || "Unlabelled";
    bySubject.set(k, (bySubject.get(k) || 0) + s.focused_minutes);
  }
  const subjects = [...bySubject].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const topMin = subjects[0]?.[1] || 1;
  const deep = store.sessions.filter((s) => Date.parse(s.started_at) >= startOfWeek(Date.now()).getTime() && s.quality === 3).length;
  // (Filtered: replaceChildren would print a null as the word "null".)
  historyEl.replaceChildren(...[
    el("div", { class: "hist-bars", role: "img", "aria-label": `Focus over the last seven days: ${days.map((d, i) => `${d.toLocaleDateString(undefined, { weekday: "short" })} ${minutes[i]} minutes`).join(", ")}` },
      days.map((d, i) =>
        el("div", { class: `hist-bar${i === 6 ? " today" : ""}` }, [
          el("i", { style: `height:${Math.max(3, (minutes[i] / max) * 56)}px` }),
          el("span", { text: d.toLocaleDateString(undefined, { weekday: "narrow" }) }),
        ])
      )
    ),
    el("p", { class: "hist-sum" }, [el("b", { class: "num", text: formatMinutes(week) }), " this week · ", el("span", { class: "num", text: formatMinutes(minutes[6]) }), " today", deep ? ` · ${deep} deep block${deep === 1 ? "" : "s"}` : ""]),
    subjects.length > 1 || (subjects.length === 1 && subjects[0][0] !== "Unlabelled")
      ? el("ul", { class: "subj-bars", "aria-label": "This week by subject" }, subjects.map(([name, m]) => el("li", {}, [el("span", { class: "subj-name", text: name }), el("span", { class: "subj-bar" }, [el("i", { style: `width:${Math.round((m / topMin) * 100)}%` })]), el("span", { class: "num faint", text: formatMinutes(m) })])))
      : null,
    focusMap(),
    todays.length
      ? el("ul", { class: "log hist-log" }, todays.map((s) => el("li", {}, [el("span", { class: "t", text: clockTime(s.started_at) }), el("span", { text: `${formatMinutes(s.focused_minutes)}${s.subject ? ` · ${s.subject}` : ""}${s.completed ? "" : " · ended early"}` })])))
      : el("p", { class: "faint", text: "No sessions yet today." }),
  ].filter(Boolean));
}

// Twelve weeks of focus, a square a day, deeper for more minutes. A picture
// of a season's work -- not a streak: an empty square is just a day.
function focusMap() {
  const weeks = 12;
  const start = startOfWeek(addDays(new Date(), -7 * (weeks - 1)));
  const today = startOfDay(Date.now()).getTime();
  const byDay = new Map();
  for (const s of store.sessions) {
    const k = dayKey(new Date(s.started_at));
    byDay.set(k, (byDay.get(k) || 0) + (s.focused_minutes || 0));
  }
  let total = 0;
  let days = 0;
  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      const t = day.getTime();
      const m = t > today ? null : byDay.get(dayKey(day)) || 0;
      if (m) (total += m), days++;
      const level = m === null ? "future" : m === 0 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4;
      cells.push(el("i", { class: `fm-cell l${level}${t === today ? " today" : ""}`, title: m === null ? "" : `${day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${m ? formatMinutes(m) : "no focus"}` }));
    }
  }
  return el("figure", { class: "focus-map" }, [
    el("div", { class: "fm-grid", role: "img", "aria-label": `Focus over the last twelve weeks: ${formatMinutes(total)} on ${days} day${days === 1 ? "" : "s"}.` }, cells),
    el("figcaption", { class: "faint small" }, [`Twelve weeks · ${formatMinutes(total)} on ${days} day${days === 1 ? "" : "s"}`, el("span", { class: "fm-key", "aria-hidden": "true" }, [0, 1, 2, 3, 4].map((l) => el("i", { class: `fm-cell l${l}` })))]),
  ]);
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
  blockEl = el("p", { class: "study-block", hidden: true });
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

  // A plan for today: 1 to 4 blocks, rests in between start by themselves.
  const planGroup = el("div", { class: "chips", role: "radiogroup", "aria-label": "Blocks today" });
  const drawPlan = () => {
    const cur = plan()?.total || 0;
    planGroup.replaceChildren(
      ...[0, 1, 2, 3, 4].map((n) => el("button", { type: "button", role: "radio", class: "chip tone-focus", "aria-checked": String(cur === n), "data-plan": String(n), text: n ? String(n) : "Free", onClick: () => { setPlan(n); drawPlan(); draw(); } }))
    );
  };
  drawPlan();

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
  const esc = (e) => {
    if (e.key === "Escape" && document.body.classList.contains("midnight")) return setDark(false);
    // Space starts, pauses and resumes -- unless you're typing.
    if (e.key === " " && document.body.dataset.view === "study" && !e.target.closest?.("input, textarea, select, button, [contenteditable]") && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      controls.querySelector(".btn-primary, .btn-ghost")?.click();
    }
  };
  document.addEventListener("keydown", esc);
  unsubs.push(() => document.removeEventListener("keydown", esc), () => setDark(false));

  tasksEl = el("div", { class: "study-tasks-list" });
  historyEl = el("div", { class: "study-history" });
  const { form } = taskForm();

  root.append(
    el("div", { class: "study-top" }, [el("p", { class: "kicker toned tone-focus", text: "Study Room" }), dark]),
    el("div", { class: "study-center" }, [
      el("div", { class: "study-dial" }, [ring.svg, el("div", { class: "study-dial-text" }, [readout, phaseEl])]),
      blockEl,
      el("div", { class: "study-what" }, [subjectInput, el("datalist", { id: "study-subjects" }, pastSubjects.map((s) => el("option", { value: s }))), taskSelect]),
      controls,
      noticeEl,
    ]),
    el("div", { class: "study-low" }, [
      el("section", { class: "study-panel", "aria-labelledby": "st-tasks" }, [el("h2", { id: "st-tasks", text: "Tasks" }), form, tasksEl]),
      el("section", { class: "study-panel", "aria-labelledby": "st-set" }, [
        el("h2", { id: "st-set", text: "Length and sound" }),
        el("div", { class: "study-field" }, [el("span", { class: "field-label", "aria-hidden": "true", text: "Each block" }), presetGroup]),
        el("div", { class: "study-field" }, [el("span", { class: "field-label", "aria-hidden": "true", text: "Blocks today" }), planGroup]),
        el("div", { class: "study-field" }, [el("span", { class: "field-label", "aria-hidden": "true", text: "Sound" }), el("div", { class: "sound-row" }, [sound, volume])]),
        el("p", { class: "faint small", text: "Sounds are generated on your device. Nothing to download. Space starts and pauses." }),
      ]),
      el("section", { class: "study-panel", "aria-labelledby": "st-hist" }, [el("h2", { id: "st-hist", text: "Your sessions" }), historyEl]),
    ])
  );
  section.append(root);

  timer = loadTimer();
  if (timer.subject) subjectInput.value = timer.subject;
  renderBlock();
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
  } else if (param?.startsWith("focus=")) {
    // "Focus on this" (Now's Due soon): that task, chosen, and begun.
    const id = decodeURIComponent(param.slice(6));
    const task = store.tasks.find((t) => t.id === id && !t.done_at);
    if (task && timer.phase === "idle") {
      if ([...taskSelect.options].some((o) => o.value === id)) taskSelect.value = id;
      if (task.subject) subjectInput.value = task.subject;
      begin("focus");
    }
  } else if (param?.startsWith("block=")) {
    // A block from the plan: its subject, its length, begun.
    const [subject, topic, kind, minutes] = decodeURIComponent(param.slice(6)).split("~");
    const block = { subject, topic, kind, minutes: Math.max(5, Math.min(90, Number(minutes) || 25)) };
    if (timer.phase === "idle" && /^[a-z0-9]{1,12}$/.test(subject) && /^[A-Za-z0-9.*]{1,12}$/.test(topic) && KINDS[kind]) {
      loadBanks().then(() => {
        if (timer.phase !== "idle") return;
        subjectInput.value = nameOf(subject).slice(0, 40);
        taskSelect.value = "";
        begin("focus", { block });
      });
    }
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

