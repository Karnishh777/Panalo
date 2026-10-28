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

  const done = entry?.intention ? scale("Did it happen?", DONE, entry.intention_done, "tone-time") : null;
  const mood = scale("How was today?", MOODS, entry?.mood, "tone-drift");
  const energy = scale("Energy", ENERGY, entry?.energy, "tone-focus");

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
