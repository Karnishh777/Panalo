// The landing page's live parts: the rising world in the hero, and the
// world demo whose sliders drive the real world model.
import { createGlobe } from "./world-render.js";
import { buildWorld } from "./model/world-model.js";
import { DAY, dayKey } from "./model/time.js";

let started = false;

// A plausible life, generated from the four slider values, run through the
// same model the app uses -- so the demo can't promise anything the product
// doesn't do.
function demoLayers({ focusHours, tasks, createHours, away }) {
  const now = Date.now();
  const last = now - away * DAY;
  const sessions = focusHours > 0 ? [{ started_at: new Date(last - 3600000).toISOString(), ended_at: new Date(last).toISOString(), focused_minutes: Math.round(focusHours * 60) }] : [];
  const doneTasks = Array.from({ length: tasks }, () => ({ done_at: new Date(last).toISOString() }));
  const logs = createHours > 0 ? [{ kind: "create", minutes: Math.round(createHours * 60), occurred_on: dayKey(last) }] : [];
  const w = buildWorld({ sessions, tasks: doneTasks, logs, sentMessages: away ? [] : Array.from({ length: 20 }, () => ({ created_at: new Date(now).toISOString() })), now });
  return w.layers;
}

export function initLanding() {
  if (started) return;
  started = true;

  const bar = document.querySelector(".land-bar");
  const onScroll = () => bar.classList.toggle("scrolled", window.scrollY > 20);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Defer the globes until the browser is idle: the words matter first.
  const later = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
  later(() => {
    try {
      const hero = createGlobe(document.getElementById("hero-globe"), { seed: "panalo-students", maxDisk: 280, spin: 0.00004 });
      hero.setLayers({ land: 0.32, lights: 160, forest: 0.6, aurora: 0.6, glow: 0.4, atmosphere: 0.7, clouds: 0.12, ring: 0.85 }, [
        { value: 1, done: true },
        { value: 0.6, done: false },
      ]);
    } catch (e) {
      console.error("hero globe", e);
    }

    const canvas = document.getElementById("demo-globe");
    let demo;
    try {
      demo = createGlobe(canvas, { seed: "your-world", interactive: true, maxDisk: 260 });
    } catch (e) {
      console.error("demo globe", e);
      return;
    }
    const inputs = {
      focus: document.getElementById("wd-focus"),
      tasks: document.getElementById("wd-tasks"),
      create: document.getElementById("wd-create"),
      away: document.getElementById("wd-away"),
    };
    const update = () => {
      const v = {
        focusHours: Number(inputs.focus.value),
        tasks: Number(inputs.tasks.value),
        createHours: Number(inputs.create.value),
        away: Number(inputs.away.value),
      };
      document.getElementById("wd-focus-out").textContent = `${v.focusHours} h`;
      document.getElementById("wd-tasks-out").textContent = String(v.tasks);
      document.getElementById("wd-create-out").textContent = `${v.createHours} h`;
      document.getElementById("wd-away-out").textContent = v.away === 1 ? "1 day" : `${v.away} days`;
      demo.setLayers(demoLayers(v));
    };
    Object.values(inputs).forEach((i) => i.addEventListener("input", update));
    update();
  });
}
