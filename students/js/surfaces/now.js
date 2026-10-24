// Now: what is happening in my universe right now?
//
// One instrument and one log, not a wall of cards. The instrument is the
// day orbit with your world at its centre. The log answers, in order of
// urgency: what's on now or next, how today's focus is going, what's due,
// how your world is doing -- and, last, an offer of rest.
import { el, emptyState, reportError, shortDate, longDate, showToast } from "../ui.js";
import { store, on, api } from "../store.js";
import { dayOrbit } from "../dayorbit.js";
import { createGlobe } from "../world-render.js";
import { buildWorld, weatherLine } from "../model/world-model.js";
import { nextUp, tasksAsDeadlines, EVENT_KINDS, countdowns } from "../model/timeline.js";
import { relTime, clockTime, clockOf, formatMinutes, DAY, sameDay } from "../model/time.js";
import * as T from "../model/focus-timer.js";
import { loadTimer, onTimer } from "../timer-state.js";
import { state } from "../../../src/state.js";
import { activeDays } from "../model/world-model.js";
import { todayEntry, rhythm, rhythmLine, dayPart, MOODS } from "../model/daily.js";
import { openCheckin, openIntention } from "../checkin.js";
import { parseQuickAdd } from "../model/quick-add.js";
import { hasPlan, currentPlan, loadBanks, banksReady, colourOf, focusedToday } from "../planner.js";
import { KINDS, nextBlock } from "../model/plan.js";
import { startBlock } from "../block-check.js";

let root;
let orbitSlot;
let logEl;
let greetEl;
let subEl;
let stepEl;
let globe = null;
let unsubs = [];
let minuteTimer = null;
let navigate;

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Late night";
  return `${part}, ${state.currentUsername}.`;
}

function allEvents() {
  return [...store.events, ...tasksAsDeadlines(store.tasks)];
}

function world() {
  return buildWorld({ sessions: store.sessions, tasks: store.tasks, logs: store.logs, goals: store.goals, entries: store.entries, bornAt: store.student?.born_at });
}

function panel(tone, title, link, children) {
  return el("section", { class: `panel ${tone}` }, [
    el("div", { class: "panel-head" }, [el("h2", { text: title }), link ? el("a", { href: link.href, text: link.label }) : null]),
    ...children,
  ]);
}

function renderOrbit() {
  orbitSlot.querySelector(".orbit-svg")?.remove();
  orbitSlot.prepend(
    dayOrbit({
      day: new Date(),
      events: allEvents(),
      sessions: store.sessions,
      tasks: store.tasks,
      onPick: () => navigate("calendar"),
    })
  );
}

function todayPanel(now) {
  const entry = todayEntry(store.entries, now);
  const days = activeDays({ sessions: store.sessions, tasks: store.tasks, logs: store.logs, entries: store.entries });
  const r = rhythm(days, now);
  const dots = el(
    "ol",
    { class: "rhythm", "aria-label": `Days you showed up: ${r.count} of the last 7` },
    r.week.map((d) => el("li", { class: `${d.active ? "lit" : ""}${d.today ? " today" : ""}`, title: `${d.name}${d.active ? ": showed up" : ""}` }, [el("i", { "aria-hidden": "true" }), el("span", { text: d.label })]))
  );

  let intention;
  if (entry?.intention) {
    const done = entry.intention_done;
    intention = el("div", { class: `intention${done === "yes" ? " done" : ""}` }, [
      el("span", { class: "intention-label faint", text: "Today's one thing" }),
      el("b", { class: "intention-text", text: entry.intention }),
      done === "yes"
        ? el("span", { class: "tag tone-world", text: "Done" })
        : el("button", { type: "button", class: "btn btn-ghost btn-sm", id: "intention-done", text: "Done", onClick: async () => { const { error } = await api.saveEntry({ intention_done: "yes" }); if (error) reportError(error); } }),
    ]);
  } else {
    intention = el("button", { type: "button", class: "link-btn intention-set", id: "intention-set", text: "Set today's one thing", onClick: () => openIntention() });
  }

  const closedMood = entry?.closed_at ? MOODS.find((m) => m.v === entry.mood)?.label : null;
  const evening = dayPart(now) === "evening";
  const close = entry?.closed_at
    ? el("p", { class: "closed-line" }, [el("span", { class: "tag tone-drift", text: `Day closed${closedMood ? ` · ${closedMood}` : ""}` }), " ", el("button", { type: "button", class: "link-btn", text: "Edit", onClick: () => openCheckin() })])
    : el("button", { type: "button", class: `btn btn-sm ${evening ? "btn-primary" : "btn-quiet"}`, id: "close-day", text: "Close the day", onClick: () => openCheckin() });

  return panel("tone-drift", "Today", { href: "#/world/journal", label: "Journal" }, [
    intention,
    el("div", { class: "rhythm-row" }, [dots, el("p", { class: "rhythm-line faint", text: rhythmLine(r.count, r.week[6].active) })]),
    close,
  ]);
}

// Capture: a task in one line, from wherever you are. A date in the line
// ("fri", "tomorrow", "12/10") becomes its due date; none, and it waits on
// the list without one. The field lives outside the log, so typing in it
// survives the log re-rendering.
function captureForm() {
  const input = el("input", { type: "text", class: "input capture-input", placeholder: "Capture a task — “Chemistry worksheet fri”", maxlength: "200", "aria-label": "Capture a task", enterkeyhint: "done", autocomplete: "off" });
  const hint = el("span", { class: "capture-hint faint", "aria-live": "polite" });
  const preview = () => {
    const v = input.value.trim();
    if (!v) return (hint.textContent = "");
    const t = taskFrom(v);
    hint.textContent = t.due_at ? `due ${new Date(t.due_at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}` : "no due date";
  };
  input.addEventListener("input", preview);
  const form = el("form", { class: "capture", novalidate: "" }, [el("span", { class: "capture-plus", "aria-hidden": "true", text: "+" }), input, hint]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    const t = taskFrom(v);
    const { error } = await api.addTask(t);
    if (error) return reportError(error);
    input.value = "";
    hint.textContent = "";
    showToast(t.due_at ? `Added — due ${shortDate(t.due_at)}.` : "Added to your list.", "success");
  });
  return form;
}
function taskFrom(text, now = Date.now()) {
  const q = parseQuickAdd(text, now);
  if (!q) return { title: text.slice(0, 200), due_at: null };
  const dated = q.timed || !sameDay(q.start, now) || /\b(today|tonight)\b/i.test(text);
  let due = null;
  if (dated) {
    due = new Date(q.start);
    if (!q.timed) due.setHours(23, 59, 0, 0);
  }
  return { title: (q.title || text).slice(0, 200), due_at: due ? due.toISOString() : null };
}

function renderLog() {
  const now = Date.now();
  const w = world();
  const { current, next } = nextUp(allEvents(), now);
  const parts = [];

  // 00. Today's plan (v0.2): what the planner has for the rest of today,
  // with today's focus (and a running block) folded in.
  if (hasPlan() && banksReady()) parts.push(planPanel(now, w));

  // 0. Today: the intention, the week's rhythm, closing the day (phase 24).
  if (!store.entriesMissing) parts.push(todayPanel(now));

  // 0b. Exams ahead (batch 3): a countdown, calm, not an alarm.
  const exams = countdowns(store.events, now, 45).slice(0, 3);
  if (exams.length) {
    parts.push(
      panel("tone-drift", "Exams ahead", { href: "#/calendar", label: "Calendar" }, [
        el(
          "ul",
          { class: "now-list exams" },
          exams.map((c) => el("li", {}, [el("b", { class: "num exam-days", text: c.days === 0 ? "Today" : c.days === 1 ? "1 day" : `${c.days} days` }), el("span", { text: c.title }), el("span", { class: "faint", text: c.at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) })]))
        ),
      ])
    );
  }

  // 1. Now / next.
  const whenLine = (o, isNow) =>
    el("div", { class: "now-next" }, [
      el("span", { class: `tag tone-${EVENT_KINDS[o.event.kind]?.tone || "time"}`, text: EVENT_KINDS[o.event.kind]?.label || "" }),
      el("b", { class: "now-title", text: o.event.title }),
      el("span", { class: "now-when" }, [
        isNow ? `until ${clockTime(o.end)}` : o.event.kind === "deadline" ? `due ${relTime(o.start.getTime(), now)}` : `${clockTime(o.start)} · ${relTime(o.start.getTime(), now)}`,
        o.event.location ? ` · ${o.event.location}` : "",
      ]),
    ]);
  const scheduled = [];
  if (current) scheduled.push(whenLine(current, true));
  if (next) scheduled.push(whenLine(next, false));
  parts.push(
    panel("tone-time", current ? "Right now" : "Next", { href: "#/calendar", label: "Calendar" }, scheduled.length ? scheduled : [el("p", { class: "muted", text: "Nothing scheduled. " }, [el("a", { href: "#/calendar/add", text: "Add your timetable" }), " and it appears on the orbit."])])
  );

  // 2. Focus.
  const t = loadTimer();
  const live = t.phase !== "idle" ? el("p", { class: "now-live" }, [el("span", { class: "live-dot", "aria-hidden": "true" }), `${t.phase === "focus" ? "Focusing" : "Resting"}${t.subject ? ` on ${t.subject}` : ""} — ${T.readout(T.remaining(t, now))} left${t.status === "paused" ? " (paused)" : ""}`]) : null;
  if (!(hasPlan() && banksReady())) parts.push(
    panel("tone-focus", "Focus today", { href: "#/study", label: "Study Room" }, [
      el("p", { class: "now-big" }, [el("b", { class: "num", text: formatMinutes(w.stats.focusMinutesToday) }), el("span", { class: "muted", text: ` · ${formatMinutes(w.stats.focusMinutesWeek)} this week` })]),
      live,
      !live ? el("a", { class: "btn btn-toned tone-focus btn-sm", href: "#/study/start-25", text: "Begin a 25-minute focus" }) : null,
    ])
  );

  // 3. Due soon.
  const due = store.tasks
    .filter((tk) => !tk.done_at && tk.due_at && Date.parse(tk.due_at) < now + 7 * DAY)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
    .slice(0, 5);
  parts.push(
    panel("tone-alert", "Due soon", { href: "#/study", label: "All tasks" }, [
      due.length
        ? el(
            "ul",
            { class: "now-list tasks" },
            due.map((tk) => {
              const box = el("input", { type: "checkbox", "aria-label": `Done: ${tk.title}` });
              box.addEventListener("change", async () => {
                const { error } = await api.toggleTask(tk);
                if (error) reportError(error);
              });
              const late = Date.parse(tk.due_at) < now;
              // Straight into a focus block on it.
              const go = el("a", { class: "icon-btn sm focus-on", href: `#/study/focus=${encodeURIComponent(tk.id)}`, "aria-label": `Focus on ${tk.title}`, title: "Focus on this", text: "▶" });
              return el("li", { class: "task-row" }, [el("label", { class: "task" }, [box, el("span", { text: tk.title }), el("span", { class: `task-due${late ? " late" : ""}`, text: late ? `was due ${relTime(Date.parse(tk.due_at), now)}` : shortDate(tk.due_at) })]), go]);
            })
          )
        : el("p", { class: "muted", text: "Nothing due in the next week." }),
    ])
  );

  // 4. World.
  const weekly = w.moons.filter((m) => store.goals.find((g) => g.id === m.id)?.weekly_minutes);
  parts.push(
    panel("tone-world", store.student?.world_name || "Your world", { href: "#/world", label: "World" }, [
      el("p", { class: "muted", text: weatherLine(w.stats) }),
      ...weekly.slice(0, 2).map((m) =>
        el("div", { class: "moon-line" }, [
          el("span", { text: m.title }),
          el("span", { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(m.value * 100)), "aria-label": `${m.title} progress` }, [el("i", { style: `width:${Math.round(m.value * 100)}%` })]),
          el("span", { class: "num faint", text: `${Math.round(m.value * 100)}%` }),
        ])
      ),
      w.discoveries[0] && Date.parse(w.discoveries[0].at) > now - 3 * DAY ? el("p", { class: "now-disc" }, [el("b", { text: `Discovery: ${w.discoveries[0].title}. ` }), w.discoveries[0].detail]) : null,
    ])
  );

  logEl.replaceChildren(...parts);

  // The one-line summary under the greeting.
  const bits = [];
  if (current) bits.push(`${current.event.title} until ${clockTime(current.end)}.`);
  else if (next) bits.push(`${next.event.title} ${relTime(next.start.getTime(), now)}.`);
  bits.push(w.stats.focusMinutesToday ? `${formatMinutes(w.stats.focusMinutesToday)} of focus so far today.` : "No focus yet today.");
  subEl.textContent = bits.join(" ");
  stepEl.replaceChildren(...nextStep(now));
  globe?.setLayers(w.layers, w.moons);
}

const hhmm = (m) => clockOf(m);

function planPanel(now, w) {
  const today = currentPlan({ now, days: 1 })[0];
  const done = focusedToday(now);
  const blocks = today?.blocks || [];
  const t = loadTimer();
  const live = t.phase !== "idle" ? el("p", { class: "now-live" }, [el("span", { class: "live-dot", "aria-hidden": "true" }), `${t.phase === "focus" ? "Focusing" : "Resting"}${t.subject ? ` on ${t.subject}` : ""} — ${T.readout(T.remaining(t, now))} left${t.status === "paused" ? " (paused)" : ""}`]) : null;
  return panel("tone-focus", "Today's plan", { href: "#/plan", label: "The week" }, [
    blocks.length
      ? el(
          "ol",
          { class: "now-list plan-today" },
          blocks.map((b) =>
            el("li", { style: `--subj:${colourOf(b.subject)}` }, [
              el("span", { class: "num faint", text: hhmm(b.start) }),
              el("i", { class: "pl-dot", "aria-hidden": "true" }),
              el("span", {}, [el("b", { text: b.own ? b.subjectName : b.topicName }), el("small", { class: "faint", text: ` ${b.own ? "" : `${b.subjectName} · `}${KINDS[b.kind].label}` })]),
              el("span", { class: "num faint", text: `${b.minutes}m` }),
            ])
          )
        )
      : el("p", { class: "muted", text: done ? "That's today's plan done. The rest of the evening is yours." : "Nothing more planned for today." }),
    live,
    el("p", { class: "faint small plan-studied", text: `${formatMinutes(done)} studied today · ${formatMinutes(w.stats.focusMinutesWeek)} this week` }),
  ]);
}

// The one thing Now is for: the next piece of work, one tap from starting.
// A block already running comes first; then homework due by tomorrow
// (it pre-empts the plan); then the plan's next block; then the newest
// open task; with nothing to do, a plain focus block.
function nextStep(now) {
  stepEl.classList.remove("plan-step");
  stepEl.style.removeProperty("--subj");
  const t = loadTimer();
  if (t.phase === "focus") {
    const task = t.taskId ? store.tasks.find((x) => x.id === t.taskId) : null;
    return [el("span", { class: "step-label", text: t.status === "paused" ? "Paused" : "Focusing" }), el("b", { text: task?.title || t.subject || "your block" }), el("a", { class: "btn btn-primary btn-sm", href: "#/study", text: "Back to it" })];
  }
  const endOfTomorrow = new Date(now);
  endOfTomorrow.setHours(23, 59, 59, 999);
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
  const urgent = store.tasks.some((tk) => !tk.done_at && tk.due_at && Date.parse(tk.due_at) <= endOfTomorrow.getTime());
  if (!urgent && hasPlan() && banksReady()) {
    const b = nextBlock(currentPlan({ now, days: 1 }));
    if (b) {
      stepEl.classList.add("plan-step");
      stepEl.style.setProperty("--subj", colourOf(b.subject));
      return [
        el("span", { class: "step-label", text: `Next step · ${clockOf(b.start)}` }),
        el("b", { class: "step-subj", text: b.own ? b.subjectName : b.topicName }),
        el("span", { class: "muted step-meta", text: `${b.own ? "" : `${b.subjectName} · `}${KINDS[b.kind].label}, ${b.minutes} min` }),
        el("button", { type: "button", class: "btn btn-primary btn-sm", id: "now-plan-go", text: "Start", onClick: () => startBlock(b) }),
      ];
    }
  }
  const open = store.tasks.filter((tk) => !tk.done_at);
  const pick =
    open.filter((tk) => tk.due_at).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))[0] ||
    open.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))[0];
  if (!pick) return [el("span", { class: "step-label", text: "Next step" }), el("span", { class: "muted", text: "Nothing on your list." }), el("a", { class: "btn btn-primary btn-sm", href: "#/study/start-25", text: "Begin a 25-minute focus" })];
  const due = pick.due_at ? (Date.parse(pick.due_at) < now ? ` · was due ${relTime(Date.parse(pick.due_at), now)}` : ` · due ${shortDate(pick.due_at)}`) : "";
  return [
    el("span", { class: "step-label", text: "Next step" }),
    el("b", { text: pick.title }),
    due ? el("span", { class: "muted", text: due }) : null,
    el("a", { class: "btn btn-primary btn-sm", id: "now-step-go", href: `#/study/focus=${encodeURIComponent(pick.id)}`, text: "Focus on it" }),
  ].filter(Boolean);
}

function render() {
  greetEl.textContent = greeting();
  renderOrbit();
  renderLog();
}

export function mount(section, ctx) {
  navigate = ctx.navigate;
  root = el("div", { class: "now" });
  greetEl = el("h1");
  subEl = el("p", { class: "s-sub" });
  stepEl = el("p", { class: "now-step", "aria-live": "polite" });
  const globeCanvas = el("canvas", { class: "orbit-world", role: "img", "aria-label": "Your world. Open World for what shapes it." });
  orbitSlot = el("a", { class: "orbit-wrap", href: "#/world", "aria-label": "Your day and your world" }, [globeCanvas]);
  logEl = el("div", { class: "now-log" });
  root.append(
    el("div", { class: "s-head" }, [el("div", { class: "now-head" }, [el("p", { class: "kicker toned tone-time", text: longDate(new Date()) }), greetEl, subEl, stepEl, captureForm()])]),
    el("div", { class: "now-grid" }, [el("div", { class: "now-instrument" }, [orbitSlot, el("p", { class: "orbit-legend faint" }, [legend("time", "classes & events"), legend("focus", "focus done"), legend("alert", "deadlines"), legend("hand", "now")])]), logEl])
  );
  section.append(root);
  try {
    globe = createGlobe(globeCanvas, { seed: state.currentUser.id, maxDisk: 220 });
  } catch (e) {
    console.error(e);
  }
  unsubs.push(on("any", render), onTimer(renderLog));
  if (store.resources === null) import("../archive-data.js").then((m) => m.loadResources()).catch(() => {});
  if (store.schemaMissing) logEl.before(emptyState("Your study data can't be saved here yet.", "See the note at the top of the page."));
}

function legend(tone, text) {
  return el("span", { class: `lg lg-${tone}` }, [el("i", { "aria-hidden": "true" }), text]);
}

// Left alone for two minutes, Now fades to just your world and its day,
// like a screensaver; any touch, key or scroll brings it back.
const IDLE_MS = 120000;
let idleTimer = null;
const WAKE = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"];
function wake() {
  root?.classList.remove("is-idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (document.querySelector("dialog[open]") || document.body.dataset.view !== "now") return wake();
    root?.classList.add("is-idle");
  }, window.__qa?.idleMs || IDLE_MS); // the browser QA shortens it
}

export function show() {
  if (hasPlan()) loadBanks();
  render();
  clearInterval(minuteTimer);
  minuteTimer = setInterval(() => !document.hidden && render(), 30000);
  WAKE.forEach((e) => window.addEventListener(e, wake, { passive: true }));
  wake();
}

export function hide() {
  clearInterval(minuteTimer);
  clearTimeout(idleTimer);
  WAKE.forEach((e) => window.removeEventListener(e, wake));
  root?.classList.remove("is-idle");
}

export function destroy() {
  hide();
  unsubs.forEach((u) => u());
  unsubs = [];
  globe?.destroy();
}
