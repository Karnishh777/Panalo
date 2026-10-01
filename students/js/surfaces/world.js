// World: the record you can see.
//
// The globe is the headline, but the legend is the point: each feature is
// printed next to the number that drives it, so the world is always
// readable, never a mystery score. Goals are moons; milestones are
// discoveries; things you did away from the desk are logged here.
import { el, openSheet, confirmSheet, showToast, chipGroup, reportError, emptyState, toLocalInput } from "../ui.js";
import { store, on, api } from "../store.js";
import { createGlobe } from "../world-render.js";
import { buildWorld, weatherLine } from "../model/world-model.js";
import { formatMinutes, dayKey, parseDayKey } from "../model/time.js";
import { state } from "../../../src/state.js";

let root;
let legendEl;
let moonsEl;
let discEl;
let logsEl;
let titleEl;
let subEl;
let globe = null;
let unsubs = [];

const LOG_KINDS = [
  { id: "read", label: "Reading", hint: "lights the seas" },
  { id: "create", label: "Making something", hint: "art, music, writing, code — lights the aurora" },
  { id: "move", label: "Moving", hint: "sport, a walk, dance — greens the land" },
  { id: "rest", label: "Resting", hint: "sleep, a real break — greens the land" },
  { id: "connect", label: "Time with people", hint: "thickens the atmosphere" },
];

function world() {
  return buildWorld({ sessions: store.sessions, tasks: store.tasks, logs: store.logs, goals: store.goals, sentMessages: store.sent, bornAt: store.student?.born_at });
}

function row(tone, name, value, explain) {
  return el("li", { class: `legend-row ${tone}` }, [el("span", { class: "legend-swatch", "aria-hidden": "true" }), el("div", {}, [el("b", { text: name }), el("small", { text: explain })]), el("span", { class: "legend-val num", text: value })]);
}

function render() {
  const w = world();
  const s = w.stats;
  titleEl.textContent = store.student?.world_name || "Your world";
  subEl.textContent = `${s.ageDays === 0 ? "Born today" : `${s.ageDays} day${s.ageDays === 1 ? "" : "s"} old`}. Every feature here is something you actually did — drag to turn it.`;
  globe?.setLayers(w.layers, w.moons);

  legendEl.replaceChildren(
    row("tone-world", "Land", formatMinutes(s.focusMinutesTotal), `Focus, all time. ${Math.round(w.layers.land * 100)}% of the surface. It never shrinks.`),
    row("tone-time", "Lights", String(s.tasksDone), "Tasks finished, all time — one light each, on the night side."),
    row("tone-drift", "Aurora", formatMinutes(s.createMinutes30), "Making things, last 30 days."),
    row("tone-world", "Forests", formatMinutes(s.bodyMinutes30), "Moving and resting, last 30 days."),
    row("tone-focus", "Glowing seas", formatMinutes(s.readMinutes30), "Reading, last 30 days."),
    row("tone-signal", "Atmosphere", `${s.messages7} msg${s.connectMinutes7 ? ` + ${formatMinutes(s.connectMinutes7)}` : ""}`, "Messages you sent and time logged with people, last 7 days."),
    row("tone-time", "Ring", `${s.active7} of 7 days`, w.layers.ring ? "You showed up five or more of the last seven days." : "Appears when you show up five days out of seven."),
    row("tone-signal", "Weather", s.daysSinceActive == null ? "—" : s.daysSinceActive === 0 ? "clear" : `${s.daysSinceActive} d away`, weatherLine(s))
  );

  // Moons.
  moonsEl.replaceChildren(
    ...(store.goals.length
      ? store.goals.map((g) => {
          const m = w.moons.find((x) => x.id === g.id);
          const pct = Math.round((m?.value || 0) * 100);
          return el("li", { class: `moon${m?.done ? " full" : ""}` }, [
            el("span", { class: "moon-dot", "aria-hidden": "true", style: `--p:${pct}%` }),
            el("div", { class: "moon-body" }, [
              el("b", { text: g.title }),
              el("small", { text: g.weekly_minutes ? `${formatMinutes(m.minutes)} of ${formatMinutes(g.weekly_minutes)} this week${g.subject ? ` · ${g.subject}` : ""} · resets Monday` : g.done_at ? "Done" : "A milestone — mark it done when it's done." }),
              el("span", { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": `${g.title} progress` }, [el("i", { style: `width:${pct}%` })]),
            ]),
            !g.weekly_minutes
              ? el("button", { type: "button", class: "btn btn-ghost btn-sm", text: g.done_at ? "Undo" : "Mark done", onClick: async () => { const { error } = await api.toggleGoal(g); if (error) reportError(error); else if (!g.done_at) showToast("A moon, completed.", "success"); } })
              : null,
            el("button", {
              type: "button",
              class: "icon-btn sm",
              "aria-label": `Remove goal: ${g.title}`,
              text: "✕",
              onClick: async () => {
                if (!(await confirmSheet({ title: `Remove “${g.title}”?`, lead: "The moon goes. Your focus time and everything else stays.", confirm: "Remove", danger: true }))) return;
                const { error } = await api.deleteGoal(g.id);
                if (error) reportError(error);
              },
            }),
          ]);
        })
      : [el("li", { class: "faint" }, ["No moons yet. A goal becomes a moon that fills as you work toward it."])])
  );

  // Discoveries.
  discEl.replaceChildren(
    ...(w.discoveries.length
      ? [el("ol", { class: "log disc-log" }, w.discoveries.map((d) => el("li", {}, [el("span", { class: "t", text: new Date(d.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }), el("div", {}, [el("b", { text: d.title }), el("p", { class: "muted", text: d.detail })])])))]
      : [el("p", { class: "faint", text: "Nothing discovered yet. Your first hour of focus is the first one." })])
  );

  // Recent logs.
  const recent = store.logs.slice(0, 8);
  logsEl.replaceChildren(
    ...(recent.length
      ? [
          el(
            "ul",
            { class: "log" },
            recent.map((l) =>
              el("li", {}, [
                el("span", { class: "t", text: parseDayKey(l.occurred_on).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }),
                el("div", { class: "log-line" }, [
                  el("span", {}, [el("b", { text: LOG_KINDS.find((k) => k.id === l.kind)?.label || l.kind }), ` · ${formatMinutes(l.minutes)}${l.note ? ` · ${l.note}` : ""}`]),
                  el("button", { type: "button", class: "icon-btn sm", "aria-label": "Delete this entry", text: "✕", onClick: async () => { const { error } = await api.deleteLog(l.id); if (error) reportError(error); } }),
                ]),
              ])
            )
          ),
        ]
      : [el("p", { class: "faint", text: "Read a chapter, made a sketch, went for a run? Log it — it shapes your world too." })])
  );
}

function openLog() {
  let kind = "read";
  const kinds = chipGroup({ label: "What did you do?", value: kind, options: LOG_KINDS.map((k) => ({ id: k.id, label: k.label })), onChange: (v) => { kind = v; hint.textContent = LOG_KINDS.find((k) => k.id === v).hint; }, toneOf: () => "tone-world" });
  const hint = el("small", { class: "field-hint", text: LOG_KINDS[0].hint });
  const minutes = el("input", { type: "number", min: "1", max: "720", value: "30", inputmode: "numeric" });
  const day = el("input", { type: "date", value: toLocalInput(new Date(), "date"), max: toLocalInput(new Date(), "date") });
  const note = el("input", { type: "text", maxlength: "140", placeholder: "Optional: what was it?" });
  openSheet({
    title: "Log an activity",
    lead: "For things that happen away from the Study Room. Be honest — it's only for you.",
    body: [el("div", { class: "field" }, [el("span", { class: "field-label", text: "What did you do?" }), kinds.node, hint]), el("div", { class: "field-row" }, [el("label", { class: "field" }, [el("span", { text: "Minutes" }), minutes]), el("label", { class: "field" }, [el("span", { text: "Day" }), day])]), el("label", { class: "field" }, [el("span", { text: "Note" }), note])],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Log it",
        kind: "btn-primary",
        submit: true,
        onClick: async () => {
          const m = Math.round(Number(minutes.value));
          if (!(m >= 1 && m <= 720)) return showToast("Minutes between 1 and 720."), false;
          const { error } = await api.addLog({ kind, minutes: m, occurred_on: day.value || dayKey(new Date()), note: note.value.trim() || null });
          if (error) return reportError(error, "Couldn't log that."), false;
          showToast("Logged. Your world noticed.", "success");
        },
      },
    ],
  });
}

function openGoal() {
  let type = "weekly";
  const title = el("input", { type: "text", maxlength: "80", placeholder: "e.g. Physics revision" });
  const minutes = el("input", { type: "number", min: "15", max: "6000", value: "180" });
  const subject = el("input", { type: "text", maxlength: "40", placeholder: "Only count focus on this subject (optional)" });
  const weeklyBits = el("div", {}, [el("label", { class: "field" }, [el("span", { text: "Minutes of focus each week" }), minutes]), el("label", { class: "field" }, [el("span", { text: "Subject" }), subject])]);
  const types = chipGroup({
    label: "Kind of goal",
    value: type,
    options: [
      { id: "weekly", label: "A weekly focus target" },
      { id: "milestone", label: "A milestone" },
    ],
    onChange: (v) => {
      type = v;
      weeklyBits.hidden = v !== "weekly";
    },
    toneOf: () => "tone-world",
  });
  openSheet({
    title: "A new moon",
    lead: "Weekly targets reset every Monday — no streak to lose. Milestones are things like “finish the robotics demo”.",
    body: [types.node, el("label", { class: "field", style: "margin-top:14px" }, [el("span", { text: "Name" }), title]), weeklyBits],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Add moon",
        kind: "btn-primary",
        submit: true,
        onClick: async () => {
          if (!title.value.trim()) return showToast("Give it a name."), false;
          const row = { title: title.value.trim() };
          if (type === "weekly") {
            const m = Math.round(Number(minutes.value));
            if (!(m >= 15 && m <= 6000)) return showToast("Between 15 and 6000 minutes."), false;
            row.weekly_minutes = m;
            if (subject.value.trim()) row.subject = subject.value.trim();
          }
          const { error } = await api.addGoal(row);
          if (error) return reportError(error, "Couldn't add that goal."), false;
        },
      },
    ],
  });
}

function rename() {
  const input = el("input", { type: "text", maxlength: "40", value: store.student?.world_name || "" });
  openSheet({
    title: "Rename your world",
    body: [el("label", { class: "field" }, [el("span", { text: "Name" }), input])],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Save",
        kind: "btn-primary",
        submit: true,
        onClick: async () => {
          const v = input.value.trim();
          if (!v) return showToast("It needs a name."), false;
          const { error } = await api.saveStudent({ world_name: v });
          if (error) return reportError(error), false;
        },
      },
    ],
  });
}

export function mount(section) {
  root = el("div", { class: "world" });
  titleEl = el("h1");
  subEl = el("p", { class: "s-sub" });
  legendEl = el("ul", { class: "legend" });
  moonsEl = el("ul", { class: "moons" });
  discEl = el("div");
  logsEl = el("div");
  const canvas = el("canvas", { class: "world-globe", tabindex: "0", role: "img", "aria-label": "Your world. Use the left and right arrow keys to turn it. The legend lists what each feature means." });
  root.append(
    el("div", { class: "s-head" }, [
      el("div", {}, [el("p", { class: "kicker toned tone-world", text: "World" }), titleEl, subEl]),
      el("div", { class: "s-actions" }, [el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Rename", onClick: rename }), el("button", { type: "button", class: "btn btn-primary", text: "Log an activity", onClick: openLog })]),
    ]),
    el("div", { class: "world-grid" }, [
      el("div", { class: "world-stage" }, [canvas]),
      el("section", { class: "panel tone-world", "aria-labelledby": "w-legend" }, [el("div", { class: "panel-head" }, [el("h2", { id: "w-legend", text: "What shapes it" })]), legendEl]),
    ]),
    el("div", { class: "world-lower" }, [
      el("section", { class: "panel tone-world" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Moons — your goals" }), el("button", { type: "button", class: "link-btn", text: "Add a moon", onClick: openGoal })]), moonsEl]),
      el("section", { class: "panel tone-time" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Discoveries" })]), discEl]),
      el("section", { class: "panel tone-drift" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Logged lately" }), el("button", { type: "button", class: "link-btn", text: "Log", onClick: openLog })]), logsEl]),
    ])
  );
  section.append(root);
  try {
    globe = createGlobe(canvas, { seed: state.currentUser.id, interactive: true, maxDisk: 320 });
  } catch (e) {
    console.error(e);
    canvas.replaceWith(emptyState("Your world can't be drawn in this browser.", "Everything it would show is listed beside it."));
  }
  unsubs.push(on("any", render));
  render();
}

export function show(param) {
  render();
  if (param === "log") openLog();
}

export function destroy() {
  unsubs.forEach((u) => u());
  unsubs = [];
  globe?.destroy();
}
