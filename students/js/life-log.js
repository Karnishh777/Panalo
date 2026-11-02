// All of life (v0.3): what else filled the day -- time with people, sport,
// reading, rest, making things, time outside, helping -- logged in a tap or
// two, each a little more of your world (model/world-model.js LIFE). Used
// when closing the day and from World. Every area is optional; nothing is
// counted against you, and there is no streak.
import { el, openSheet, showToast, reportError } from "./ui.js";
import { store, api } from "./store.js";
import { LIFE } from "./model/world-model.js";
import { dayKey, formatMinutes } from "./model/time.js";

const MINUTES = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];
const HINT = {
  connect: "lights the cities",
  move: "greens the valleys",
  read: "brightens the stars",
  rest: "moonlight at night",
  create: "colours the air",
  outdoors: "parts the clouds",
  help: "towns appear",
};
const START = { connect: 60, move: 45, read: 30, rest: 30, create: 45, outdoors: 30, help: 30 };

/**
 * The areas as chips, for `day` (a "YYYY-MM-DD" key): tap one to add it and
 * pick how long. Returns { node, chosen, save } -- save() logs the chosen
 * ones and returns false (after saying why) if a save failed.
 */
export function lifeChips(day = dayKey(new Date())) {
  const chosen = new Map(); // kind -> minutes
  const node = el("div", { class: "life-chips" });
  const logged = (kind) => store.logs.filter((l) => l.occurred_on === day && l.kind === kind).reduce((n, l) => n + (Number(l.minutes) || 0), 0);
  const draw = () =>
    node.replaceChildren(
      ...LIFE.map((a) => {
        const on = chosen.has(a.id);
        const already = logged(a.id);
        const chip = el("button", {
          type: "button",
          class: `chip ${a.tone}`,
          "aria-pressed": String(on),
          "data-kind": a.id,
          title: HINT[a.id],
          text: already ? `${a.label} · ${formatMinutes(already)} so far` : a.label,
          onClick: () => {
            if (on) chosen.delete(a.id);
            else chosen.set(a.id, START[a.id]);
            draw();
            node.querySelector(`[data-mins="${a.id}"]`)?.focus();
          },
        });
        if (!on) return chip;
        const sel = el(
          "select",
          { class: "input mins", "data-mins": a.id, "aria-label": `How long: ${a.label.toLowerCase()}` },
          MINUTES.map((m) => el("option", { value: String(m), text: formatMinutes(m) }))
        );
        sel.value = String(chosen.get(a.id));
        sel.addEventListener("change", () => chosen.set(a.id, Number(sel.value)));
        return el("span", { class: "act-on" }, [chip, sel, el("small", { class: "faint", text: HINT[a.id] })]);
      })
    );
  draw();
  async function save() {
    for (const [kind, minutes] of chosen) {
      const { error } = await api.addLog({ kind, minutes, occurred_on: day, note: null });
      if (error) {
        reportError(error, "That couldn't be logged. Try again.");
        return false;
      }
      chosen.delete(kind); // saved: never sent twice if something after fails
    }
    return true;
  }
  return { node, chosen, save };
}

/** A sheet on its own: what else filled today (or yesterday). */
export function openLifeLog({ onSaved } = {}) {
  let day = dayKey(new Date());
  const slot = el("div");
  let chips = lifeChips(day);
  slot.append(chips.node);
  const whenBtn = (label, key) =>
    el("button", {
      type: "button",
      class: `chip${key === day ? " on" : ""}`,
      "aria-pressed": String(key === day),
      "data-day": label.toLowerCase(),
      text: label,
      onClick: () => {
        day = key;
        chips = lifeChips(day);
        slot.replaceChildren(chips.node);
        when.querySelectorAll("button").forEach((b) => {
          const pressed = b === when.querySelector(`[data-day="${label.toLowerCase()}"]`);
          b.classList.toggle("on", pressed);
          b.setAttribute("aria-pressed", String(pressed));
        });
      },
    });
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  const when = el("div", { class: "chips", role: "group", "aria-label": "Which day" }, [whenBtn("Today", day), whenBtn("Yesterday", yesterday)]);
  openSheet({
    title: "What else filled the day?",
    lead: "Tap what you did and roughly how long. Each one grows a part of your world. All optional.",
    cls: "sheet-life",
    body: [when, slot],
    actions: [
      { label: "Not now", kind: "btn-quiet" },
      {
        label: "Log it",
        kind: "btn-primary",
        submit: true,
        id: "life-save",
        onClick: async (btn) => {
          if (!chips.chosen.size) {
            showToast("Tap at least one thing, or close this.");
            return false;
          }
          btn.disabled = true;
          try {
            if (!(await chips.save())) return false;
          } finally {
            btn.disabled = false;
          }
          showToast("Logged. Your world grew a little.", "success");
          onSaved?.();
        },
      },
    ],
  });
}
