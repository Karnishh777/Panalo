// Watch it grow (batch 2): your world from the day it was born to now, in
// about eight seconds. Land rises, lights come on, the ring forms, and a
// date and two numbers run underneath. A slider takes you to any moment by
// hand (the only control under reduced motion).
import { el } from "./ui.js";
import { store } from "./store.js";
import { createGlobe } from "./world-render.js";
import { timeline } from "./model/chronicle.js";
import { formatMinutes } from "./model/time.js";
import { reducedMotion } from "./motion.js";
import { state } from "../../src/state.js";

const FRAMES = 32;
const LENGTH = 8000;

export function openTimelapse() {
  if (document.querySelector(".timelapse")) return;
  const frames = timeline({ sessions: store.sessions, tasks: store.tasks, logs: store.logs, goals: store.goals, entries: store.entries, sentMessages: store.sent, bornAt: store.student?.born_at }, Date.now(), FRAMES);
  const still = reducedMotion();
  const canvas = el("canvas", { class: "timelapse-world", "aria-hidden": "true" });
  const date = el("p", { class: "timelapse-date num" });
  const stats = el("p", { class: "timelapse-stats faint num" });
  const slider = el("input", { type: "range", class: "range tone-world", min: "0", max: String(FRAMES - 1), step: "1", value: still ? String(FRAMES - 1) : "0", "aria-label": "Move through time" });
  const replay = el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Play again", onClick: () => play() });
  const close = el("button", { type: "button", class: "btn btn-quiet btn-sm timelapse-close", text: "Close", onClick: () => end() });
  const root = el("div", { class: "timelapse", role: "dialog", "aria-modal": "true", "aria-label": "Your world, growing" }, [
    close,
    el("p", { class: "kicker toned tone-world", text: "Watch it grow" }),
    el("h2", { class: "timelapse-title", text: store.student?.world_name || "Your world" }),
    canvas,
    date,
    stats,
    el("div", { class: "timelapse-controls" }, [slider, still ? null : replay]),
  ]);
  document.body.append(root);

  let globe = null;
  try {
    globe = createGlobe(canvas, { seed: state.currentUser.id, maxDisk: 560, spin: 1.2 });
  } catch (e) {
    console.error(e);
  }
  let shown = -1;
  const show = (i) => {
    if (i === shown) return;
    shown = i;
    const f = frames[i];
    globe?.setLayers(f.layers, f.moons);
    date.textContent = new Date(f.at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    stats.textContent = `${formatMinutes(f.focusMinutes)} of focus · ${f.tasksDone} light${f.tasksDone === 1 ? "" : "s"}`;
    slider.value = String(i);
  };
  slider.addEventListener("input", () => {
    cancelAnimationFrame(raf);
    show(Number(slider.value));
  });

  let raf = 0;
  function play() {
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const step = (t) => {
      // rAF's timestamp can be a hair before t0 on the first frame.
      const k = Math.min(1, Math.max(0, (t - t0) / LENGTH));
      // Ease out: the early days pass quickly, the recent ones linger.
      show(Math.min(FRAMES - 1, Math.floor((1 - Math.pow(1 - k, 2)) * FRAMES)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  show(still ? FRAMES - 1 : 0);
  if (!still) play();

  const onKey = (e) => e.key === "Escape" && end();
  document.addEventListener("keydown", onKey);
  close.focus({ preventScroll: true });
  function end() {
    cancelAnimationFrame(raf);
    document.removeEventListener("keydown", onKey);
    globe?.destroy?.();
    root.remove();
  }
}
