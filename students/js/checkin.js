// The two small moments of the day (phase 24).
//
//   openIntention   morning: the one thing that would make today count.
//   openCheckin     evening: close the day in under twenty seconds. How it
//                   went, mood and energy, what else filled it (one tap each,
//                   logged to your world), one thing learned, one good thing.
//
// Everything is optional except how the day felt, and nothing is shared.
import { el, openSheet, showToast, reportError } from "./ui.js";
import { store, api } from "./store.js";
import { MOODS, ENERGY, DONE, todayEntry, journal } from "./model/daily.js";
import { dayKey, formatMinutes } from "./model/time.js";

export const ACTIVITIES = [
  { id: "read", label: "Read", tone: "tone-focus" },
  { id: "create", label: "Made something", tone: "tone-drift" },
  { id: "move", label: "Moved", tone: "tone-world" },
  { id: "rest", label: "Rested", tone: "tone-world" },
  { id: "connect", label: "With people", tone: "tone-signal" },
];
const MINUTES = [15, 30, 45, 60, 90, 120];

// A row of chips with a scale (mood, energy): radiogroup, re-pressable.
function scale(label, options, value, tone) {
  let current = value ?? null;
  const group = el("div", { class: "chips scale", role: "radiogroup", "aria-label": label });
  const draw = () =>
    group.replaceChildren(
      ...options.map((o) =>
        el("button", {
          type: "button",
          role: "radio",
          class: `chip ${tone}`,
          "aria-checked": String(o.v === current),
          "data-v": String(o.v),
          text: o.label,
          onClick: () => {
            current = o.v;
            draw();
          },
        })
      )
    );
  draw();
  return { node: group, get value() { return current; } };
}

/** The morning: one intention. Suggestions come from what's due soonest. */
export function openIntention({ onSaved } = {}) {
  const entry = todayEntry(store.entries);
  const input = el("input", { type: "text", maxlength: "140", value: entry?.intention || "", placeholder: "e.g. Finish the chemistry worksheet", "aria-label": "Today's intention" });
  const soon = store.tasks
    .filter((t) => !t.done_at)
    .sort((a, b) => (Date.parse(a.due_at || "9999") || 9e15) - (Date.parse(b.due_at || "9999") || 9e15))
    .slice(0, 3);
  const picks = soon.length
    ? el("div", { class: "chips intention-picks", "aria-label": "From your tasks" }, soon.map((t) => el("button", { type: "button", class: "chip tone-time", text: t.title, onClick: () => { input.value = t.title.slice(0, 140); input.focus(); } })))
    : null;
  openSheet({
    title: "One thing for today",
    lead: "The one thing that would make today count. Small is fine. You'll be asked about it this evening, gently.",
    body: [el("label", { class: "field" }, [el("span", { text: "Today's intention" }), input]), picks],
    actions: [
      { label: "Not today", kind: "btn-quiet" },
      {
        label: "Set it",
        kind: "btn-primary",
        submit: true,
        id: "intention-save",
        onClick: async () => {
          const v = input.value.trim();
          if (!v) return input.focus(), false;
          const { error } = await api.saveEntry({ intention: v, intention_done: null });
          if (error) return reportError(error, "Couldn't save that."), false;
          showToast("Set. It's on Now all day.", "success");
          onSaved?.();
        },
      },
    ],
  });
}

/** The evening: close the day. */
export function openCheckin({ onSaved } = {}) {
  const entry = todayEntry(store.entries);
  const today = dayKey(new Date());
  const loggedToday = store.logs.filter((l) => l.occurred_on === today);

  const done = entry?.intention ? scale("Did it happen?", DONE, entry.intention_done, "tone-time") : null;
  const mood = scale("How was today?", MOODS, entry?.mood, "tone-drift");
  const energy = scale("Energy", ENERGY, entry?.energy, "tone-focus");

  // What else filled the day: tap to add, pick how long.
  const chosen = new Map(); // id -> minutes
  const acts = el("div", { class: "checkin-acts" });
  const drawActs = () =>
    acts.replaceChildren(
      ...ACTIVITIES.map((a) => {
        const on = chosen.has(a.id);
        const already = loggedToday.filter((l) => l.kind === a.id).reduce((n, l) => n + l.minutes, 0);
        const chip = el("button", {
          type: "button",
          class: `chip ${a.tone}`,
          "aria-pressed": String(on),
          "data-kind": a.id,
          text: already ? `${a.label} · ${formatMinutes(already)} logged` : a.label,
          onClick: () => {
            if (on) chosen.delete(a.id);
            else chosen.set(a.id, 30);
            drawActs();
          },
        });
        if (!on) return chip;
        const sel = el("select", { class: "input mins", "aria-label": `Minutes of ${a.label.toLowerCase()}` }, MINUTES.map((m) => el("option", { value: String(m), text: formatMinutes(m) })));
        sel.value = String(chosen.get(a.id));
        sel.addEventListener("change", () => chosen.set(a.id, Number(sel.value)));
        return el("span", { class: "act-on" }, [chip, sel]);
      })
    );
  drawActs();

  const learned = el("input", { type: "text", maxlength: "280", value: entry?.learned || "", placeholder: "Something you didn't know this morning", "aria-label": "One thing you learned" });
  const win = el("input", { type: "text", maxlength: "280", value: entry?.win || "", placeholder: "However small", "aria-label": "One good thing" });

  const block = (label, node, hint) => el("div", { class: "field" }, [el("span", { class: "field-label", text: label }), node, hint ? el("small", { class: "field-hint", text: hint }) : null]);
  openSheet({
    title: entry?.closed_at ? "Today, revisited" : "Close the day",
    lead: "Twenty seconds. Only you will ever see this.",
    body: [
      done ? block(`“${entry.intention}”`, done.node, "Your intention this morning.") : null,
      block("How was today?", mood.node),
      block("Energy", energy.node),
      block("What else filled the day?", acts, "Tap what you did. It's logged to your world: reading lights the seas, making lights the aurora."),
      el("label", { class: "field" }, [el("span", { text: "One thing you learned" }), learned]),
      el("label", { class: "field" }, [el("span", { text: "One good thing" }), win]),
    ],
    actions: [
      { label: "Later", kind: "btn-quiet" },
      {
        label: entry?.closed_at ? "Save" : "Close the day",
        kind: "btn-primary",
        submit: true,
        id: "checkin-save",
        onClick: async (btn) => {
          if (!mood.value) {
            showToast("Pick how today felt. That's the only thing needed.");
            return false;
          }
          btn.disabled = true;
          try {
            for (const [kind, minutes] of chosen) {
              const { error } = await api.addLog({ kind, minutes, occurred_on: today, note: null });
              if (error) return reportError(error, "Couldn't log that."), false;
            }
            const { error } = await api.saveEntry({
              mood: mood.value,
              energy: energy.value,
              intention_done: done ? done.value : entry?.intention_done ?? null,
              learned: learned.value.trim() || null,
              win: win.value.trim() || null,
              closed_at: entry?.closed_at || new Date().toISOString(),
            });
            if (error) return reportError(error, "Couldn't save today."), false;
          } finally {
            btn.disabled = false;
          }
          const pages = journal(store.entries).length;
          showToast(entry?.closed_at ? "Saved." : `Day closed. Page ${pages} of your journal.`, "success");
          onSaved?.();
        },
      },
    ],
  });
}
