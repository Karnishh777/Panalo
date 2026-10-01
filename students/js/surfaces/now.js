// Now: what is happening in my universe right now?
//
// One instrument and one log, not a wall of cards. The instrument is the
// day orbit with your world at its centre. The log answers, in order of
// urgency: what's on now or next, how today's focus is going, who's
// waiting for you, what's due, how your world is doing, what's new in your
// files -- and, last, an offer of rest.
import { el, emptyState, reportError, shortDate, longDate } from "../ui.js";
import { store, on, api } from "../store.js";
import { dayOrbit } from "../dayorbit.js";
import { createGlobe } from "../world-render.js";
import { buildWorld, weatherLine } from "../model/world-model.js";
import { nextUp, tasksAsDeadlines, EVENT_KINDS } from "../model/timeline.js";
import { relTime, clockTime, formatMinutes, DAY } from "../model/time.js";
import { pickDrift } from "../model/drift-pick.js";
import { LIBRARY } from "../model/drift-library.js";
import * as T from "../model/focus-timer.js";
import { loadTimer, onTimer } from "../timer-state.js";
import { titleOf } from "../signals-data.js";
import { state } from "../../../src/state.js";

let root;
let orbitSlot;
let logEl;
let greetEl;
let subEl;
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
  return buildWorld({ sessions: store.sessions, tasks: store.tasks, logs: store.logs, goals: store.goals, sentMessages: store.sent, bornAt: store.student?.born_at });
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

function renderLog() {
  const now = Date.now();
  const w = world();
  const { current, next } = nextUp(allEvents(), now);
  const parts = [];

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
  parts.push(
    panel("tone-focus", "Focus today", { href: "#/study", label: "Study Room" }, [
      el("p", { class: "now-big" }, [el("b", { class: "num", text: formatMinutes(w.stats.focusMinutesToday) }), el("span", { class: "muted", text: ` · ${formatMinutes(w.stats.focusMinutesWeek)} this week` })]),
      live,
      !live ? el("a", { class: "btn btn-toned tone-focus btn-sm", href: "#/study/start-25", text: "Begin a 25-minute focus" }) : null,
    ])
  );

  // 3. Signals waiting.
  const waiting = store.conversations.filter((c) => c.unread).slice(0, 4);
  const doors = store.requests.length;
  parts.push(
    panel("tone-signal", "Signals", { href: "#/signals", label: "All signals" }, [
      waiting.length
        ? el(
            "ul",
            { class: "now-list" },
            waiting.map((c) => el("li", {}, [el("a", { href: `#/signals/${c.id}` }, [el("span", { class: "sig-star pulsing", "aria-hidden": "true" }), el("b", { text: titleOf(c) }), el("span", { class: "muted ellipsis", text: c.preview || "" }), el("span", { class: "pulse-count", text: String(c.unread) })])]))
          )
        : el("p", { class: "muted", text: store.conversations.length ? "All quiet. Nobody's waiting on you." : "No conversations yet." }),
      doors ? el("p", {}, [el("a", { href: "#/signals", text: `${doors} ${doors === 1 ? "person is" : "people are"} waiting at the door of a room you host.` })]) : null,
    ])
  );

  // 4. Due soon.
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
              return el("li", {}, [el("label", { class: "task" }, [box, el("span", { text: tk.title }), el("span", { class: `task-due${late ? " late" : ""}`, text: late ? `was due ${relTime(Date.parse(tk.due_at), now)}` : shortDate(tk.due_at) })])]);
            })
          )
        : el("p", { class: "muted", text: "Nothing due in the next week." }),
    ])
  );

  // 5. World.
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

  // 6. New in the archive, from other people.
  const fresh = (store.resources || []).filter((r) => r.owner_id !== state.currentUser.id && Date.parse(r.created_at) > now - 7 * DAY).slice(0, 3);
  if (fresh.length) {
    parts.push(panel("tone-archive", "New in your circles", { href: "#/archive", label: "Archive" }, [el("ul", { class: "now-list" }, fresh.map((r) => el("li", {}, [el("a", { href: "#/archive" }, [el("b", { text: r.title }), el("span", { class: "muted", text: ` · @${store.owners[r.owner_id] || "someone"}` })])])))]));
  }

  // 7. Rest, offered last and once.
  const drift = pickDrift(now, store.student?.interests || [], LIBRARY);
  parts.push(el("p", { class: "now-drift tone-drift" }, ["Need a breather? Today's Drift: ", el("a", { href: "#/drift", text: drift.play.title.toLowerCase() }), " and two other small things."]));

  logEl.replaceChildren(...parts);

  // The one-line summary under the greeting.
  const bits = [];
  if (current) bits.push(`${current.event.title} until ${clockTime(current.end)}.`);
  else if (next) bits.push(`${next.event.title} ${relTime(next.start.getTime(), now)}.`);
  const unread = store.unreadTotal || 0;
  if (unread) bits.push(`${unread} unread signal${unread === 1 ? "" : "s"}.`);
  bits.push(w.stats.focusMinutesToday ? `${formatMinutes(w.stats.focusMinutesToday)} of focus so far today.` : "No focus yet today.");
  subEl.textContent = bits.join(" ");
  globe?.setLayers(w.layers, w.moons);
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
  const globeCanvas = el("canvas", { class: "orbit-world", role: "img", "aria-label": "Your world. Open World for what shapes it." });
  orbitSlot = el("a", { class: "orbit-wrap", href: "#/world", "aria-label": "Your day and your world" }, [globeCanvas]);
  logEl = el("div", { class: "now-log" });
  root.append(
    el("div", { class: "s-head" }, [el("div", {}, [el("p", { class: "kicker toned tone-time", text: longDate(new Date()) }), greetEl, subEl])]),
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

export function show() {
  render();
  clearInterval(minuteTimer);
  minuteTimer = setInterval(() => !document.hidden && render(), 30000);
}

export function hide() {
  clearInterval(minuteTimer);
}

export function destroy() {
  hide();
  unsubs.forEach((u) => u());
  unsubs = [];
  globe?.destroy();
}
