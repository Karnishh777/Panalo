// The landing page's live parts: the hero world (yours to spin, tip, speed
// up, slow down, reverse and zoom), the water and flame that wind around it,
// petals and embers, sections that slash open as they arrive, and the world
// demo whose sliders drive the real world model.
import { createGlobe } from "./world-render.js";
import { buildWorld } from "./model/world-model.js";
import { DAY, dayKey } from "./model/time.js";
import { ribbons, drift, reveal, speedLines, burstOn, impactFrame, comic } from "./fx.js";
import { onLook } from "./looks.js";
import { el } from "./ui.js";
import { reducedMotion, lively } from "./motion.js";
import { globeDock, dockToggle } from "./globe-dock.js";
import { initLandingHud } from "./landing-hud.js";
import { initLandingArt } from "./landing-art.js";

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
  reveal(document.getElementById("landing"));
  initLandingArt();
  initLandingHud();

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

// The two worlds on the landing are WebGL, each with its own textures and
// buffers. They exist only while the landing is on screen: sign-up, the
// setup and the app stop them and give the GPU memory back (low-memory
// laptops ran out of it while an account was being made).
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
  // Defer the globes until the browser is idle: the words matter first.
  if (window.requestIdleCallback) g.idle = window.requestIdleCallback(go, { timeout: 1500 });
  else g.timer = setTimeout(go, 300);
}

function buildGlobes(g) {
  // Panalo Night opens on a photo, not the hero globe: don't build what
  // isn't shown.
  if (getComputedStyle(document.querySelector(".hero-stage")).display !== "none") {
    let dock = null;
    try {
      const hero = createGlobe($("hero-globe"), { seed: "panalo-students", interactive: true, maxDisk: 300, maxPixels: 1500, onMotion: (m) => dock?.sync(m) });
      hero.setLayers({ earth: 1, cities: 0.85, land: 0.34, lights: 180, forest: 0.6, aurora: 0.7, glow: 0.35, atmosphere: 0.75, clouds: 0.22, ring: 0.9 }, [
        { value: 1, done: true },
        { value: 0.6, done: false },
      ]);
      const extra = [];
      if (!reducedMotion()) {
        // In the comic look (Verse), ink water and flame wind round the
        // world, following its speed and direction. In Glass and Signal the
        // world is filmed, not drawn: an anamorphic flare crosses it now and
        // then instead (css/looks.css).
        const back = document.querySelector(".rib-back"), front = document.querySelector(".rib-front");
        const world = document.querySelector(".hero-world");
        world.append(el("i", { class: "hero-flare", "aria-hidden": "true" }));
        let fx = null;
        // Calm by default: the ribbons wind only with lively effects on,
        // or when you turn them on here.
        let wanted = lively();
        const sync = () => {
          const on = wanted && comic();
          world.classList.toggle("no-ribbons", !on);
          if (on && !fx) fx = ribbons(back, front, { getMotion: () => hero.getMotion() });
          if (!on && fx) {
            fx.destroy();
            fx = null;
          }
        };
        sync();
        const offLook = onLook(sync);
        g.stops.push(() => {
          offLook();
          fx?.destroy();
          fx = null;
        });
        extra.push(
          dockToggle("≋", "Ink water and flame (Verse)", wanted, (on) => {
            wanted = on;
            sync();
          })
        );
        if (lively()) {
          const d = drift(document.querySelector(".hero-drift"), { count: 26 });
          g.stops.push(() => d.destroy());
        }
      }
      dock = globeDock(hero, { extra });
      dock.node.id = "hero-dock";
      document.querySelector(".hero-stage").append(dock.node);
      g.stops.push(() => {
        dock?.destroy?.();
        dock?.node.remove();
        document.querySelector(".hero-world .hero-flare")?.remove();
        hero.destroy?.();
      });
    } catch (e) {
      console.error("hero globe", e);
    }
  }
  {
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
}

