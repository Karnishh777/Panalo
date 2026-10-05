// Dawn: the first few seconds of each day (phase 24).
//
// The first time the app opens on a new day -- on any device -- the sun
// comes up over your own world, and the day is read out: which day of your
// world this is, and what changed since you were last here. Then one
// question: the morning asks for an intention, the evening offers to close
// the day. Skippable at any moment (Escape, a click on Skip); under reduced
// motion it's the same card, still.
//
// The open is recorded (daily_entries.opened_at) before anything plays, so
// a second device the same morning goes straight in.
import { el, longDate } from "./ui.js";
import { store, api } from "./store.js";
import { createGlobe } from "./world-render.js";
import { buildWorld } from "./model/world-model.js";
import { todayEntry, lastVisit, sinceLast, sinceLines, dayPart, dayNumber } from "./model/daily.js";
import { reducedMotion } from "./motion.js";
import { state } from "../../src/state.js";
import { openIntention, openCheckin } from "./checkin.js";

let playing = false;
const SUN_FROM = 172; // degrees: behind the world, a rim of fire
const SUN_TO = 26; // nearly behind us: full morning
const LENGTH = 3600;

const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function sunAt(deg, elevation = 14) {
  const az = (deg * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e)];
}

/** Whether today's dawn is still to come. */
export function dawnDue(now = Date.now()) {
  if (!store.loaded || store.entriesMissing || store.schemaMissing || !store.student) return false;
  return !todayEntry(store.entries, now)?.opened_at;
}

/**
 * Play the dawn if it's due. Resolves when it's over (or at once if not).
 * `quiet` records the open without playing (the day the world was born).
 */
export async function maybeDawn({ quiet = false } = {}) {
  if (playing || !dawnDue()) return;
  playing = true;
  const now = Date.now();
  const since = lastVisit(store.entries, now);
  // Recorded first: a refresh mid-dawn, or another device, won't replay it.
  const saved = await api.saveEntry({ opened_at: new Date(now).toISOString() });
  if (saved.error || quiet || document.hidden) {
    playing = false;
    return;
  }
  try {
    await play({ since, now });
  } finally {
    playing = false;
  }
}

function play({ since, now }) {
  return new Promise((resolve) => {
    const still = reducedMotion();
    const w = buildWorld({ sessions: store.sessions, tasks: store.tasks, logs: store.logs, goals: store.goals, sentMessages: store.sent, entries: store.entries, bornAt: store.student?.born_at, now });
    const part = dayPart(now);
    const n = dayNumber(store.student?.born_at, now);
    const name = store.student?.world_name || "your world";
    const lines = since
      ? sinceLines(sinceLast({ sessions: store.sessions, tasks: store.tasks, logs: store.logs, discoveries: w.discoveries }, since, now))
      : ["A new day on your world."];

    const canvas = el("canvas", { class: "dawn-world", "aria-hidden": "true" });
    const skip = el("button", { type: "button", class: "btn btn-quiet btn-sm dawn-skip", text: "Skip", onClick: () => close() });
    const entry = todayEntry(store.entries, now);
    const actions = el("div", { class: "dawn-actions" });
    if (part === "evening") {
      actions.append(
        el("button", { type: "button", class: "btn btn-primary btn-lg", id: "dawn-close-day", text: "Close the day", onClick: () => { close(); openCheckin(); } }),
        el("button", { type: "button", class: "btn btn-quiet", text: "Just looking", onClick: () => close() })
      );
    } else {
      actions.append(
        el("button", { type: "button", class: "btn btn-primary btn-lg", id: "dawn-intention", text: entry?.intention ? "Begin the day" : "Set today's intention", onClick: () => { close(); if (!entry?.intention) openIntention(); } }),
        el("button", { type: "button", class: "btn btn-quiet", text: "Straight in", onClick: () => close() })
      );
    }
    const list = el("ul", { class: "dawn-lines" }, lines.map((t, i) => el("li", { style: `--i:${i}`, text: t })));
    const card = el("div", { class: "dawn-card" }, [
      el("p", { class: "kicker toned tone-time dawn-date", text: longDate(new Date(now)) }),
      el("h1", { class: "dawn-title" }, [el("span", { class: "dawn-day", text: `Day ${n}` }), el("span", { class: "dawn-of", text: ` of ${name}` })]),
      el("p", { class: "dawn-since faint", text: since ? "Since you were last here" : "" }),
      list,
      actions,
    ]);
    const root = el("div", { class: `dawn${still ? " still" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": `Day ${n} of ${name}` }, [el("div", { class: "dawn-sky", "aria-hidden": "true" }), canvas, card, skip]);
    document.body.append(root);
    document.body.classList.add("in-dawn");

    let globe = null;
    try {
      globe = createGlobe(canvas, { seed: state.currentUser.id, maxDisk: 640, spin: 0.6 });
      globe.setLayers(w.layers, w.moons);
    } catch (e) {
      console.error(e);
    }

    let raf = 0;
    const t0 = performance.now();
    const step = (t) => {
      const k = ease((t - t0) / LENGTH);
      globe?.setSun?.(sunAt(SUN_FROM + (SUN_TO - SUN_FROM) * k, 6 + 14 * k), 0.12 + 0.2 * k);
      if (t - t0 < LENGTH) raf = requestAnimationFrame(step);
    };
    if (still) globe?.setSun?.(sunAt(SUN_TO, 20), 0.3);
    else raf = requestAnimationFrame(step);

    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    // Focus lands on the first action once it's there.
    setTimeout(() => actions.querySelector("button")?.focus({ preventScroll: true }), still ? 0 : 2600);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      root.classList.add("leaving");
      const end = () => {
        globe?.destroy?.();
        root.remove();
        document.body.classList.remove("in-dawn");
        resolve();
      };
      if (still) end();
      else setTimeout(end, 450);
    }
  });
}
