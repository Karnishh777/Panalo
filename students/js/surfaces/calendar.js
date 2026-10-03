// Calendar: your timetable, deadlines and plans.
//
// Two views. The day view is the orbit again, with an agenda beside it.
// The week view is deliberately conventional -- a timetable grid -- because
// planning a week is a job people already know how to do on a grid, and
// "creative" would only get in the way. Classes repeat weekly; tasks with a
// due date appear as deadlines automatically.
import { el, openSheet, confirmSheet, showToast, chipGroup, reportError, emptyState, toLocalInput, longDate } from "../ui.js";
import { store, on, api } from "../store.js";
import { dayOrbit } from "../dayorbit.js";
import { occurrencesOnDay, occurrencesBetween, tasksAsDeadlines, EVENT_KINDS } from "../model/timeline.js";
import { startOfDay, startOfWeek, addDays, clockTime, sameDay, formatMinutes, DAY, HOUR } from "../model/time.js";

let root;
let day = startOfDay(new Date());
let view = "day";
let bodyEl;
let titleEl;
let unsubs = [];
let navigate;

function events() {
  return [...store.events, ...tasksAsDeadlines(store.tasks)];
}

function tone(kind) {
  return `tone-${EVENT_KINDS[kind]?.tone || "time"}`;
}

function occLine(o, { showDay = false } = {}) {
  const ev = o.event;
  const time = ev.kind === "deadline" ? `due ${clockTime(o.start)}` : `${clockTime(o.start)}${o.end > o.start ? `–${clockTime(o.end)}` : ""}`;
  return el(
    "li",
    { class: `agenda-item ${tone(ev.kind)}` },
    [
      el("span", { class: "agenda-time num", text: showDay ? `${o.start.toLocaleDateString(undefined, { weekday: "short" })} ${time}` : time }),
      el("button", { type: "button", class: "agenda-body", onClick: () => (ev._task ? navigate("study") : openEvent(ev)) }, [
        el("b", { text: ev.title }),
        el("span", { class: "muted" }, [el("span", { class: "tag", text: EVENT_KINDS[ev.kind]?.label }), ev.repeat_weekly ? " · every week" : "", ev.location ? ` · ${ev.location}` : "", ev._task ? " · from your tasks" : ""]),
      ]),
    ]
  );
}

function renderDay() {
  const occ = occurrencesOnDay(events(), day);
  const dayStart = day.getTime();
  const focus = store.sessions.filter((s) => Date.parse(s.started_at) >= dayStart && Date.parse(s.started_at) < dayStart + DAY);
  const focused = focus.reduce((n, s) => n + s.focused_minutes, 0);
  bodyEl.replaceChildren(
    el("div", { class: "cal-day" }, [
      el("div", { class: "cal-orbit" }, [dayOrbit({ day, events: events(), sessions: store.sessions, tasks: store.tasks, onPick: (o) => (o.event._task ? navigate("study") : openEvent(o.event)) })]),
      el("div", { class: "cal-agenda" }, [
        el("section", { class: "panel tone-time" }, [
          el("div", { class: "panel-head" }, [el("h2", { text: sameDay(day, Date.now()) ? "Today" : day.toLocaleDateString(undefined, { weekday: "long" }) }), el("button", { type: "button", class: "link-btn", text: "Add", onClick: () => openEvent(null) })]),
          occ.length
            ? el("ul", { class: "agenda" }, occ.map((o) => occLine(o)))
            : el("div", { class: "cal-empty" }, [
                el("p", { class: "cal-empty-lead", text: "A clear orbit. What goes on it?" }),
                el("div", { class: "quick-add" }, Object.entries(EVENT_KINDS).map(([k, v]) =>
                  el("button", { type: "button", class: `quick-chip tone-${v.tone}`, onClick: () => openEvent(null, k) }, [el("i", { "aria-hidden": "true" }), el("span", { text: v.label })]))),
                el("p", { class: "faint", text: "Classes can repeat every week — add your timetable once and it fills every orbit." }),
              ]),
        ]),
        el("section", { class: "panel tone-focus" }, [
          el("div", { class: "panel-head" }, [el("h2", { text: "Focus done" })]),
          focus.length
            ? el("ul", { class: "log" }, focus.map((s) => el("li", {}, [el("span", { class: "t", text: clockTime(s.started_at) }), el("span", { text: `${formatMinutes(s.focused_minutes)}${s.subject ? ` · ${s.subject}` : ""}` })])))
            : el("p", { class: "faint", text: "No focus sessions on this day." }),
          focus.length ? el("p", { class: "muted", text: `${formatMinutes(focused)} in total.` }) : null,
        ]),
      ]),
    ])
  );
}

function renderWeek() {
  const start = startOfWeek(day);
  const end = addDays(start, 7);
  const occ = occurrencesBetween(events(), start, end);
  // Show 8:00–20:00, widened to fit anything outside it.
  let first = 8;
  let last = 20;
  for (const o of occ) {
    first = Math.min(first, o.start.getHours());
    last = Math.max(last, Math.min(24, o.end.getHours() + (o.end.getMinutes() ? 1 : 0)));
  }
  const hours = last - first;
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const grid = el("div", { class: "week-grid", style: `--hours:${hours}` }, [
    el("div", { class: "week-hours", "aria-hidden": "true" }, Array.from({ length: hours }, (_, i) => el("span", { text: `${String(first + i).padStart(2, "0")}:00` }))),
    ...days.map((d) => {
      const col = el("div", { class: `week-col${sameDay(d, Date.now()) ? " today" : ""}` }, [
        el("button", { type: "button", class: "week-day", onClick: () => { day = startOfDay(d); setView("day"); } }, [el("span", { text: d.toLocaleDateString(undefined, { weekday: "short" }) }), el("b", { class: "num", text: String(d.getDate()) })]),
      ]);
      const lane = el("div", { class: "week-lane" });
      for (const o of occ.filter((x) => sameDay(x.start, d))) {
        const top = ((o.start.getHours() + o.start.getMinutes() / 60 - first) / hours) * 100;
        const h = Math.max(((o.end - o.start) / HOUR / hours) * 100, 3.2);
        lane.append(
          el("button", { type: "button", class: `week-ev ${tone(o.event.kind)}${o.event.kind === "deadline" ? " point" : ""}`, style: `top:${top}%;height:${h}%`, title: `${o.event.title} · ${clockTime(o.start)}`, onClick: () => (o.event._task ? navigate("study") : openEvent(o.event)) }, [el("b", { text: o.event.title }), el("span", { text: clockTime(o.start) })])
        );
      }
      if (sameDay(d, Date.now())) {
        const n = new Date();
        const top = ((n.getHours() + n.getMinutes() / 60 - first) / hours) * 100;
        if (top >= 0 && top <= 100) lane.append(el("i", { class: "week-now", style: `top:${top}%`, "aria-hidden": "true" }));
      }
      col.append(lane);
      return col;
    }),
  ]);
  // On phones the grid becomes a list, grouped by day.
  const list = el(
    "div",
    { class: "week-list" },
    days.map((d) => {
      const items = occ.filter((x) => sameDay(x.start, d));
      return el("section", { class: "week-list-day" }, [el("h3", { text: longDate(d) }), items.length ? el("ul", { class: "agenda" }, items.map((o) => occLine(o))) : el("p", { class: "faint", text: "Free." })]);
    })
  );
  bodyEl.replaceChildren(grid, list);
}

function render() {
  if (!bodyEl) return;
  titleEl.textContent = view === "day" ? longDate(day) : `Week of ${startOfWeek(day).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
  if (view === "day") renderDay();
  else renderWeek();
}

function setView(v) {
  view = v;
  root.querySelectorAll("[data-view-btn]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.viewBtn === v)));
  render();
}

function step(n) {
  day = startOfDay(addDays(day, view === "week" ? 7 * n : n));
  render();
}

function openEvent(ev, presetKind = null) {
  const editing = !!ev;
  let kind = ev?.kind || presetKind || "class";
  const start = ev ? new Date(ev.starts_at) : (() => {
    const d = new Date(day);
    const now = new Date();
    d.setHours(sameDay(day, now) ? Math.min(22, now.getHours() + 1) : 9, 0, 0, 0);
    return d;
  })();
  const end = ev?.ends_at ? new Date(ev.ends_at) : new Date(start.getTime() + HOUR);
  const title = el("input", { type: "text", maxlength: "120", value: ev?.title || "", placeholder: "e.g. Physics — Lab 2" });
  const date = el("input", { type: "date", value: toLocalInput(start, "date") });
  const from = el("input", { type: "time", value: toLocalInput(start, "time") });
  const to = el("input", { type: "time", value: toLocalInput(end, "time") });
  const repeat = el("input", { type: "checkbox" });
  repeat.checked = ev ? !!ev.repeat_weekly : true;
  const location = el("input", { type: "text", maxlength: "80", value: ev?.location || "", placeholder: "Room, building or link (optional)" });
  const toField = el("label", { class: "field" }, [el("span", { text: "Ends" }), to]);
  const repeatRow = el("label", { class: "check" }, [repeat, el("span", { text: "Every week — part of my timetable" })]);
  const sync = () => {
    toField.hidden = kind === "deadline";
    repeatRow.hidden = kind === "deadline";
  };
  const kinds = chipGroup({
    label: "Kind",
    value: kind,
    options: Object.entries(EVENT_KINDS).map(([id, k]) => ({ id, label: k.label })),
    toneOf: (id) => tone(id),
    onChange: (v) => {
      kind = v;
      if (!editing) repeat.checked = v === "class";
      sync();
    },
  });
  sync();
  const actions = [{ label: "Cancel", kind: "btn-quiet" }];
  if (editing) {
    actions.unshift({
      label: "Delete",
      kind: "btn-danger",
      onClick: async () => {
        if (!(await confirmSheet({ title: `Delete “${ev.title}”?`, lead: ev.repeat_weekly ? "This removes it from every week." : undefined, confirm: "Delete", danger: true }))) return false;
        const { error } = await api.deleteEvent(ev.id);
        if (error) return reportError(error), false;
      },
    });
  }
  actions.push({
    label: editing ? "Save" : "Add",
    kind: "btn-primary",
    submit: true,
    onClick: async () => {
      if (!title.value.trim()) return showToast("Give it a title."), false;
      const s = new Date(`${date.value}T${from.value || "09:00"}`);
      if (Number.isNaN(s.getTime())) return showToast("Check the date and time."), false;
      let e = null;
      if (kind !== "deadline" && to.value) {
        e = new Date(`${date.value}T${to.value}`);
        if (e <= s) e = new Date(e.getTime() + DAY); // ends after midnight
      }
      const row = { title: title.value.trim(), kind, starts_at: s.toISOString(), ends_at: e ? e.toISOString() : null, repeat_weekly: kind !== "deadline" && repeat.checked, location: location.value.trim() || null };
      const { error } = editing ? await api.updateEvent(ev.id, row) : await api.addEvent(row);
      if (error) return reportError(error, "Couldn't save that."), false;
      day = startOfDay(s);
      render();
    },
  });
  openSheet({
    title: editing ? "Edit" : "Add to the calendar",
    lead: editing && ev.repeat_weekly ? "Changes apply to every week." : null,
    body: [
      el("label", { class: "field" }, [el("span", { text: "What" }), title]),
      el("div", { class: "field" }, [el("span", { class: "field-label", text: "Kind" }), kinds.node]),
      el("div", { class: "field-row" }, [el("label", { class: "field" }, [el("span", { text: "Day" }), date]), el("label", { class: "field" }, [el("span", { text: kind === "deadline" ? "Due at" : "Starts" }), from])]),
      toField,
      repeatRow,
      el("label", { class: "field" }, [el("span", { text: "Where" }), location]),
    ],
    actions,
  });
}

export function mount(section, ctx) {
  navigate = ctx.navigate;
  root = el("div", { class: "calendar" });
  titleEl = el("h1");
  bodyEl = el("div", { class: "cal-body" });
  root.append(
    el("div", { class: "s-head" }, [
      el("div", {}, [el("p", { class: "kicker toned tone-time", text: "Calendar" }), titleEl]),
      el("div", { class: "s-actions" }, [
        el("div", { class: "chips", role: "tablist", "aria-label": "View" }, [
          el("button", { type: "button", role: "tab", class: "chip tone-time", "data-view-btn": "day", "aria-selected": "true", text: "Day", onClick: () => setView("day") }),
          el("button", { type: "button", role: "tab", class: "chip tone-time", "data-view-btn": "week", "aria-selected": "false", text: "Week", onClick: () => setView("week") }),
        ]),
        el("button", { type: "button", class: "icon-btn", "aria-label": "Previous", text: "←", onClick: () => step(-1) }),
        el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Today", onClick: () => { day = startOfDay(new Date()); render(); } }),
        el("button", { type: "button", class: "icon-btn", "aria-label": "Next", text: "→", onClick: () => step(1) }),
        el("button", { type: "button", class: "btn btn-primary btn-sm", text: "Add", onClick: () => openEvent(null) }),
      ]),
    ]),
    bodyEl
  );
  section.append(root);
  unsubs.push(on("any", render));
  render();
}

export function show(param) {
  render();
  if (param === "add") openEvent(null);
}

export function destroy() {
  unsubs.forEach((u) => u());
  unsubs = [];
}
