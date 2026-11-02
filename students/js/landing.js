// The front page's live parts (v0.3): the try-it (three taps, a real first
// week), Pan with a tail per subject, sections that open as they arrive,
// and the world demo whose sliders drive the real world model.
import { createGlobe } from "./world-render.js";
import { buildWorld } from "./model/world-model.js";
import { DAY, dayKey } from "./model/time.js";
import { reveal, speedLines, burstOn, impactFrame } from "./fx.js";
import { initLandingHud } from "./landing-hud.js";
import { initTryPlan } from "./try-plan.js";
import { panFox } from "./pan.js";

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
  const w = buildWorld({ sessions, tasks: doneTasks, logs, now });
  return w.layers;
}

const $ = (id) => document.getElementById(id);

export function initLanding() {
  if (started) return startGlobes();
  started = true;

  const bar = document.querySelector(".land-bar");
  const onScroll = () => bar.classList.toggle("scrolled", window.scrollY > 20);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  reveal($("landing"));
  initLandingHud();
  initTryPlan($("try-plan"));
  drawPan();

  // The calls to action land with a hit.
  document.querySelectorAll("#landing .fx-cta").forEach((a) => {
    a.addEventListener("pointerenter", () => burstOn(a, { count: 22, dur: 320 }));
    a.addEventListener("click", () => {
      impactFrame();
      const r = a.getBoundingClientRect();
      speedLines(r.left + r.width / 2, r.top + r.height / 2, { count: 70, dur: 520, ring: true });
    });
  });

  startGlobes();
}

// Meet Pan: the first week (two dim tails) beside the week before exams
// (nine, all lit), and a slider to try the idea.
function drawPan() {
  const stage = $("pan-stage");
  if (!stage || stage.dataset.ready) return;
  stage.dataset.ready = "1";
  stage.append(panFox({ pose: "early", tails: 2, lit: 0, size: 150, label: "Pan in the first week: two dim tails" }));
  const live = livePan();
  stage.append(live.box);
  const range = $("pan-ready");
  const out = $("pan-ready-out");
  const draw = () => {
    const k = Number(range.value);
    out.textContent = `${k} of 9`;
    live.set(k);
  };
  range?.addEventListener("input", draw);
  if (range) draw();
}

function livePan() {
  const box = document.createElement("div");
  box.className = "pan-live";
  return {
    box,
    set: (k) => box.replaceChildren(panFox({ pose: k >= 9 ? "cheer" : "idle", tails: 9, lit: k, size: 290 })),
  };
}

// The demo world is WebGL, with its own textures and buffers. It exists
// only while the landing is on screen: sign-up, the setup and the app stop
// it and give the GPU memory back (low-memory laptops ran out of it while
// an account was being made).
let globes = null;

export function stopGlobes() {
  if (!globes) return;
  const g = globes;
  globes = null;
  clearTimeout(g.timer);
  if (g.idle && window.cancelIdleCallback) window.cancelIdleCallback(g.idle);
  for (const f of g.stops) {
    try {
      f();
    } catch (e) {
      console.error(e);
    }
  }
}

function startGlobes() {
  if (globes || !started) return;
  const g = (globes = { stops: [], timer: 0, idle: 0 });
  const go = () => {
    if (globes !== g) return;
    buildGlobes(g);
  };
  // Defer the world until the browser is idle: the words matter first.
  if (window.requestIdleCallback) g.idle = window.requestIdleCallback(go, { timeout: 1500 });
  else g.timer = setTimeout(go, 300);
}

function buildGlobes(g) {
  const canvas = $("demo-globe");
  let demo;
  try {
    demo = createGlobe(canvas, { seed: "your-world", interactive: true, maxDisk: 260 });
    g.stops.push(() => demo.destroy?.());
  } catch (e) {
    console.error("demo globe", e);
    return;
  }
  const inputs = {
    focus: $("wd-focus"),
    tasks: $("wd-tasks"),
    create: $("wd-create"),
    away: $("wd-away"),
  };
  const update = () => {
    const v = {
      focusHours: Number(inputs.focus.value),
      tasks: Number(inputs.tasks.value),
      createHours: Number(inputs.create.value),
      away: Number(inputs.away.value),
    };
    $("wd-focus-out").textContent = `${v.focusHours} h`;
    $("wd-tasks-out").textContent = String(v.tasks);
    $("wd-create-out").textContent = `${v.createHours} h`;
    $("wd-away-out").textContent = v.away === 1 ? "1 day" : `${v.away} days`;
    demo.setLayers(demoLayers(v));
  };
  Object.values(inputs).forEach((i) => i.addEventListener("input", update));
  g.stops.push(() => Object.values(inputs).forEach((i) => i.removeEventListener("input", update)));
  update();
}
