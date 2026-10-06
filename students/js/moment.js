// Discovery moments (batch 2): when you reach something -- your first hour,
// a ring, a hundred pages -- the screen stops for a second to say so.
//
// A flash, the name of it written large, one sentence, your world turning
// behind it, and a way on. Shown once per discovery, on whichever device
// you're on (which ones you've seen follows your preferences). Never in the
// middle of a focus block or over an open sheet: those wait their turn.
// Under reduced motion it's the same card, still.
import { el, getPrefs, setPrefs } from "./ui.js";
import { store } from "./store.js";
import { createGlobe } from "./world-render.js";
import { buildWorld } from "./model/world-model.js";
import { newMoments } from "./model/chronicle.js";
import { reducedMotion } from "./motion.js";
import { impactFrame } from "./fx.js";
import { loadTimer } from "./timer-state.js";
import { state } from "../../src/state.js";
import { DAY } from "./model/time.js";

let showing = false;
let timer = 0;

function busy() {
  if (showing || document.hidden) return true;
  if (document.querySelector("dialog[open], .dawn, .story, .timelapse")) return true;
  if (document.body.classList.contains("in-birth")) return true;
  // A focus block is sacred: celebrate after it.
  if (document.body.dataset.view === "study" && loadTimer().phase === "focus") return true;
  return false;
}

/** Look for new discoveries soon (debounced: writes come in bursts). */
export function checkMomentsSoon(ms = 1200) {
  clearTimeout(timer);
  timer = setTimeout(checkMoments, ms);
}

export async function checkMoments() {
  if (!store.loaded || store.schemaMissing || !store.student) return;
  if (busy()) return checkMomentsSoon(4000);
  const w = buildWorld({ sessions: store.sessions, tasks: store.tasks, logs: store.logs, goals: store.goals, entries: store.entries, sentMessages: store.sent, bornAt: store.student.born_at });
  const prefs = getPrefs();
  // The first time this runs for an account, only the last day counts as news.
  const firstRun = !Array.isArray(prefs.momentsSeen);
  const { fresh, stale } = newMoments(w.discoveries, prefs.momentsSeen || [], Date.now(), firstRun ? DAY : 7 * DAY);
  const seen = [...new Set([...(prefs.momentsSeen || []), ...stale.map((d) => d.id)])];
  if (stale.length || firstRun) setPrefs({ momentsSeen: seen });
  if (!fresh.length) return;
  for (const d of fresh) {
    setPrefs({ momentsSeen: [...new Set([...(getPrefs().momentsSeen || []), d.id])] });
    await show(d, w);
    if (busy()) return checkMomentsSoon(4000);
  }
}

function show(d, w) {
  showing = true;
  return new Promise((resolve) => {
    const still = reducedMotion();
    const canvas = el("canvas", { class: "moment-world", "aria-hidden": "true" });
    const on = el("button", { type: "button", class: "btn btn-primary", id: "moment-on", text: "Onward", onClick: () => close() });
    // Letter by letter for the eye; one label for screen readers.
    const title = el("h2", { class: "moment-title", "aria-label": d.title }, [...d.title].map((ch, i) => el("span", { style: `--i:${i}`, "aria-hidden": "true", text: ch === " " ? " " : ch })));
    const root = el("div", { class: `moment${still ? " still" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": `Discovery: ${d.title}` }, [
      el("div", { class: "moment-flash", "aria-hidden": "true" }),
      canvas,
      el("div", { class: "moment-card" }, [el("p", { class: "kicker toned tone-time", text: "Discovery" }), title, el("p", { class: "moment-detail", text: d.detail }), on]),
    ]);
    document.body.append(root);
    let globe = null;
    try {
      globe = createGlobe(canvas, { seed: state.currentUser.id, maxDisk: 520, spin: 1.4 });
      globe.setLayers(w.layers, w.moons);
    } catch (e) {
      console.error(e);
    }
    if (!still) impactFrame({ strong: true });
    setTimeout(() => on.focus({ preventScroll: true }), still ? 0 : 900);
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      root.classList.add("leaving");
      setTimeout(
        () => {
          globe?.destroy?.();
          root.remove();
          showing = false;
          resolve();
        },
        still ? 0 : 380
      );
    }
  });
}
