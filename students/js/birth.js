// The first time inside: a universe begins, a world forms, you name it.
//
// About fifteen seconds of film, drawn on one canvas with a few hundred
// particles and scored with synthesized sound -- no video, no assets.
// "Skip" jumps straight to the questions; reduced motion replaces the
// sequence with a line of text; if the canvas can't run at all, the
// questions appear immediately. The world that forms is the
// real one: seeded from your account, the same world the World page shows.
import { el, chipGroup, showToast, reportError } from "./ui.js";
import { reducedMotion, animationLoop } from "./motion.js";
import { createGlobe } from "./world-render.js";
import { createScore, setSoundWanted } from "./birth-score.js";
import { INTERESTS } from "./model/drift-library.js";
import { api, store } from "./store.js";
import { state } from "../../src/state.js";

const $ = (id) => document.getElementById(id);
const NAMES = ["Halcyon", "Tamarind", "Velora", "Nadir", "Lumen", "Arka", "Cinder", "Meridian", "Solace", "Kestrel", "Aurel", "Thaliya"];

function suggestions(seed) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = NAMES[h % NAMES.length];
  const b = NAMES[(h >>> 5) % NAMES.length];
  return [...new Set([a, `${b}-${100 + (h % 900)}`, `${state.currentUsername || "my"}'s world`])];
}

function line(text, { low = false } = {}) {
  const p = $("birth-line");
  p.classList.add("out");
  return new Promise((r) =>
    setTimeout(() => {
      p.textContent = text;
      p.classList.toggle("low", low);
      p.classList.remove("out");
      r();
    }, 450)
  );
}

// A small seeded random, so each person's nebula is their own and stays
// the same when they watch it again.
function seeded(seed) {
  let a = 0x9e3779b9;
  for (const c of String(seed)) a = Math.imul(a ^ c.charCodeAt(0), 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x, a, b) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Painted once, small, and scaled up: blur is what a nebula is made of.
function paintNebula(rand) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 320;
  const g = c.getContext("2d");
  g.scale(1.6, 1.6); // drawn in a 320 x 200 space
  const palette = [[124, 88, 255], [255, 96, 178], [64, 196, 226], [255, 176, 96], [150, 120, 255]];
  const phase = rand() * 6;
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 48; i++) {
    const u = rand();
    const x = 320 * (0.06 + 0.88 * u);
    const y = 200 * (0.5 + 0.24 * Math.sin(u * 3.2 + phase)) + (rand() - 0.5) * 70;
    const r = 200 * (0.1 + rand() * 0.34);
    const [cr, cg, cb] = palette[Math.floor(rand() * palette.length)];
    const a = 0.05 + rand() * 0.11;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Dark lanes of dust across the glow.
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 14; i++) {
    const x = rand() * 320, y = 200 * (0.5 + 0.24 * Math.sin((x / 320) * 3.2 + phase)) + (rand() - 0.5) * 40;
    const r = 10 + rand() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(0,0,0,0.5)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

// The timeline, in milliseconds of the sequence's own clock. That clock
// only runs while the intro is on screen, so a hidden tab pauses the film
// rather than missing it.
export const IGNITION = 4200;
export const LENGTH = 14600;

/**
 * Draw the beginning of a universe on one canvas: a slate, a countdown,
 * the bang (flash, shockwave, a lens flare), the warp out through new
 * stars, a nebula, and a disk of dust falling into a world.
 * `cues` are [{at, run}] fired on the same clock.
 */
function runSequence(canvas, seed, cues) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  let w = 0, h = 0;
  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };
  resize();
  window.addEventListener("resize", resize);

  const rand = seeded(seed || "panalo");
  const big = w * h >= 500000;
  const TAU = Math.PI * 2;
  const star = (z) => {
    const a = Math.random() * TAU, r = 0.03 + Math.random() * 1.25;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, z, temp: Math.random() };
  };
  const stars = Array.from({ length: big ? 560 : 280 }, () => star(0.05 + Math.random() * 0.95));
  const motes = Array.from({ length: big ? 760 : 360 }, () => ({
    th: Math.random() * TAU,
    r: 0,
    band: Math.random(),
    size: 0.6 + Math.random() * 1.5,
    warm: Math.random(),
  }));
  const pull = Array.from({ length: big ? 180 : 90 }, () => ({ th: Math.random() * TAU, r0: 0.45 + Math.random() * 0.4, off: Math.random() }));
  const nebula = paintNebula(rand);
  const queue = [...cues].sort((a, b) => a.at - b.at);
  let e = 0;

  const loop = animationLoop(canvas, (t, dt) => {
    e += dt;
    while (queue.length && queue[0].at <= e) queue.shift().run();
    const cx = w / 2, cy = h / 2, S = Math.min(w, h), a = e - IGNITION;

    // The camera shakes for a moment after the bang.
    const k = a > 0 && a < 750 ? 14 * (1 - a / 750) ** 2 : 0;
    ctx.setTransform(dpr, 0, 0, dpr, (Math.random() - 0.5) * k * dpr, (Math.random() - 0.5) * k * dpr);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(-30, -30, w + 60, h + 60);

    if (a < 0) {
      // Slate: an instrument grid, a slow scan line, one point of light.
      const gridA = 0.07 * smooth(e, 0, 900);
      ctx.strokeStyle = `rgba(140,180,255,${gridA})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = cx % 56; x < w; x += 56) (ctx.moveTo(x, 0), ctx.lineTo(x, h));
      for (let y = cy % 56; y < h; y += 56) (ctx.moveTo(0, y), ctx.lineTo(w, y));
      ctx.stroke();
      const sy = (e * 0.22) % (h + 120) - 60;
      const scan = ctx.createLinearGradient(0, sy - 60, 0, sy + 60);
      scan.addColorStop(0, "rgba(120,170,255,0)");
      scan.addColorStop(0.5, `rgba(120,170,255,${gridA * 0.9})`);
      scan.addColorStop(1, "rgba(120,170,255,0)");
      ctx.fillStyle = scan;
      ctx.fillRect(0, sy - 60, w, 120);

      // Countdown: a ring closes on the point once a number, and matter
      // starts to fall inwards.
      const c = e - 1500;
      if (c > 0) {
        const p = (c % 900) / 900;
        ctx.strokeStyle = `rgba(160,205,255,${0.55 * (1 - p)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, S * 0.34 * (1 - p) ** 0.7 + 4, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = "rgba(220,235,255,0.9)";
        for (const m of pull) {
          const q = (c / 1700 + m.off) % 1;
          const r = S * m.r0 * (1 - q) ** 2;
          ctx.globalAlpha = q * clamp01(c / 600);
          ctx.fillRect(cx + Math.cos(m.th) * r, cy + Math.sin(m.th) * r, 1.4, 1.4);
        }
        ctx.globalAlpha = 1;
      }
      // The point breathes, swells with the countdown, then draws in.
      let g = 3 + Math.sin(e / 170) * 1.5 + smooth(e, 1500, 3900) * 9;
      if (a > -320) g *= Math.max(0.15, -a / 320);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, g * 4);
      glow.addColorStop(0, "rgba(255,255,255,1)");
      glow.addColorStop(0.25, "rgba(255,236,210,0.55)");
      glow.addColorStop(1, "rgba(255,200,160,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(cx - g * 4, cy - g * 4, g * 8, g * 8);
      return;
    }

    // Nebula: opens behind everything, turning very slowly.
    const nA = smooth(a, 1900, 4200) * (1 - 0.45 * smooth(a, 6200, 8800));
    if (nA > 0) {
      // Big enough that no edge shows at any angle, on any screen shape.
      const D = (Math.hypot(w, h) / 0.625) * (1.25 - 0.15 * smooth(a, 1900, 10000));
      ctx.save();
      ctx.globalAlpha = nA;
      ctx.translate(cx, cy);
      ctx.rotate(a * 0.000018 - 0.2);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(nebula, -D / 2, (-D / 2) * (200 / 320), D, D * (200 / 320));
      ctx.restore();
    }

    // Stars, racing past and then settling into a sky.
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const v = 0.0021 * Math.exp(-a / 1050) + 0.000028;
    const F = S * 0.36;
    const cool = smooth(a, 0, 3200);
    for (const st of stars) {
      const z0 = st.z;
      st.z -= v * dt;
      if (st.z <= 0.03) Object.assign(st, star(1));
      if (st.z >= z0) continue;
      const x1 = cx + (st.x / st.z) * F, y1 = cy + (st.y / st.z) * F;
      const x0 = cx + (st.x / z0) * F, y0 = cy + (st.y / z0) * F;
      if (x1 < -40 || x1 > w + 40 || y1 < -40 || y1 > h + 40) continue;
      const near = 1 - st.z;
      const warm = st.temp < 0.35;
      const r = 255, gch = Math.round(255 - cool * (warm ? 60 : 25)), b = Math.round(255 - cool * (warm ? 130 : 0));
      ctx.strokeStyle = `rgba(${warm ? r : Math.round(255 - cool * 80)},${gch},${b},${Math.min(1, near * 1.4)})`;
      ctx.lineWidth = 0.5 + near * 1.9;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1 + 0.01, y1);
      ctx.stroke();
    }

    // Dust: a disk that gathers, spins, and falls into the world.
    const gather = smooth(a, 4300, 6300);
    const fall = smooth(a, 6600, 9200);
    const dustA = gather * (1 - smooth(a, 7400, 9600));
    if (dustA > 0) {
      for (const m of motes) {
        const target = S * (0.2 + m.band * (0.3 - 0.18 * fall));
        if (!m.r) m.r = S * (0.55 + m.band * 0.4);
        m.r += (target - m.r) * (1 - Math.exp(-dt / 700));
        m.th += dt * 0.0011 * Math.pow((S * 0.25) / m.r, 1.5);
        const x = cx + Math.cos(m.th) * m.r;
        const y = cy + Math.sin(m.th) * m.r * 0.27;
        const inner = 1 - m.band;
        ctx.fillStyle = m.warm < 0.5
          ? `rgba(255,${Math.round(170 + 60 * inner)},${Math.round(110 + 80 * inner)},${dustA * 0.8})`
          : `rgba(${Math.round(170 + 60 * inner)},${Math.round(190 + 40 * inner)},255,${dustA * 0.7})`;
        ctx.fillRect(x, y, m.size, m.size);
      }
    }

    // The bang: a white-out, a shockwave split into colour at its edge,
    // and a long horizontal flare across the lens.
    if (a < 900) {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(255,252,245,${(1 - a / 900) ** 2})`;
      ctx.fillRect(-30, -30, w + 60, h + 60);
      ctx.globalCompositeOperation = "lighter";
    }
    if (a < 2000) {
      const q = a / 2000;
      const rad = S * 0.04 + (1 - (1 - q) ** 3) * Math.hypot(w, h) * 0.62;
      ctx.lineWidth = 2 + 12 * (1 - q);
      [[255, 80, 80, -4], [80, 255, 120, 0], [90, 140, 255, 4]].forEach(([r, g, b, o]) => {
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.55 * (1 - q)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, rad + o), 0, TAU);
        ctx.stroke();
      });
    }
    if (a < 2800) {
      const q = (1 - a / 2800) ** 1.5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.016);
      const L = w * 0.75;
      const flare = ctx.createRadialGradient(0, 0, 0, 0, 0, L);
      flare.addColorStop(0, `rgba(235,244,255,${q})`);
      flare.addColorStop(0.25, `rgba(120,170,255,${q * 0.5})`);
      flare.addColorStop(1, "rgba(60,110,255,0)");
      ctx.fillStyle = flare;
      ctx.fillRect(-L, -L, L * 2, L * 2);
      ctx.restore();
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.16 * q + 1);
      core.addColorStop(0, `rgba(255,255,255,${q})`);
      core.addColorStop(1, "rgba(255,230,200,0)");
      ctx.fillStyle = core;
      ctx.fillRect(cx - S * 0.2, cy - S * 0.2, S * 0.4, S * 0.4);
      // Two ghosts of the flare, mirrored through the centre of the lens.
      for (const [f, rr, col] of [[0.55, 0.035, "150,200,255"], [-0.35, 0.06, "255,170,120"]]) {
        const gx = cx + (cx * 0.5) * f, gy = cy + (cy * 0.3) * f;
        const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, S * rr);
        gr.addColorStop(0, `rgba(${col},${0.25 * q})`);
        gr.addColorStop(0.7, `rgba(${col},${0.12 * q})`);
        gr.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = gr;
        ctx.fillRect(gx - S * rr, gy - S * rr, S * rr * 2, S * rr * 2);
      }
    }
  });
  loop.start();
  return () => {
    loop.destroy();
    window.removeEventListener("resize", resize);
  };
}

function buildForm(form, { onDone }) {
  const sug = suggestions(state.currentUser?.id || "x");
  const nameInput = el("input", { type: "text", id: "birth-world-name", maxlength: "40", autocomplete: "off", value: sug[0], "aria-describedby": "birth-name-hint" });
  const interests = new Set();
  const interestChips = el(
    "div",
    { class: "chips", role: "group", "aria-label": "Interests" },
    INTERESTS.map((it) => {
      const b = el("button", { type: "button", class: "chip tone-world", "aria-pressed": "false", text: it.label });
      b.addEventListener("click", () => {
        if (interests.has(it.id)) interests.delete(it.id);
        else if (interests.size < 5) interests.add(it.id);
        else return showToast("Pick up to five — you can change them later.", "");
        b.setAttribute("aria-pressed", String(interests.has(it.id)));
      });
      return b;
    })
  );
  const rhythm = chipGroup({
    label: "Weekly focus goal",
    value: 300,
    options: [
      { id: 180, label: "3 hours" },
      { id: 300, label: "5 hours" },
      { id: 600, label: "10 hours" },
      { id: 900, label: "15 hours" },
      { id: 0, label: "No goal yet" },
    ],
    toneOf: () => "tone-world",
  });

  const steps = [
    {
      title: "Name your world.",
      lead: "It formed a few seconds ago from nothing. It's yours, and it grows from what you do here.",
      body: [
        el("label", { class: "field" }, [el("span", { text: "World name" }), nameInput, el("small", { id: "birth-name-hint", class: "field-hint", text: "Only you see this." })]),
        el("div", { class: "suggest" }, sug.map((s) => el("button", { type: "button", text: s, onClick: () => (nameInput.value = s) }))),
      ],
    },
    {
      title: "What pulls you in?",
      lead: "Pick up to five. Drift uses them to choose what it shows you each day.",
      body: [interestChips],
    },
    {
      title: "How much focus makes a good week?",
      lead: "This becomes your first moon. It fills as you study, and it resets every Monday — no streak to lose.",
      body: [rhythm.node],
    },
  ];

  let step = 0;
  const render = () => {
    const s = steps[step];
    const back = el("button", { type: "button", class: "btn btn-quiet", text: step ? "Back" : "Skip for now" });
    const next = el("button", { type: "submit", class: "btn btn-primary", text: step < steps.length - 1 ? "Next" : "Enter my universe" });
    back.addEventListener("click", () => {
      if (step) {
        step--;
        render();
      } else finish(true);
    });
    form.replaceChildren(
      el("div", { class: "birth-steps", "aria-hidden": "true" }, steps.map((_, i) => el("i", { class: i <= step ? "on" : "" }))),
      el("h2", { id: "birth-title", text: s.title }),
      el("p", { class: "lead", text: s.lead }),
      ...s.body,
      el("div", { class: "birth-actions" }, [back, next])
    );
    form.querySelector("input, button.chip")?.focus();
  };

  let saving = false;
  async function finish(skipped = false) {
    if (saving) return;
    saving = true;
    const worldName = (nameInput.value || "").trim().slice(0, 40) || sug[0];
    const { error } = await api.saveStudent({ world_name: worldName, interests: skipped ? [] : [...interests] });
    if (error) {
      saving = false;
      reportError(error, "Couldn't save your world. Check your connection and try again.");
      return;
    }
    if (!skipped && rhythm.value > 0) {
      const g = await api.addGoal({ title: "Weekly focus", weekly_minutes: rhythm.value });
      if (g.error) reportError(g.error, "Your world is saved, but the weekly goal wasn't. Add it from World.");
    }
    onDone();
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    if (step < steps.length - 1) {
      step++;
      render();
    } else finish(false);
  };
  render();
}

// Text that types itself, a character at a time, like an instrument log.
function typeInto(node, text, alive) {
  let i = 0;
  const step = () => {
    if (!alive()) return;
    node.textContent = text.slice(0, ++i);
    if (i < text.length) setTimeout(step, 16);
  };
  step();
}

/**
 * @param {{replay?: boolean, onDone: () => void}} opts
 */
export function runBirth({ replay = false, onDone }) {
  const root = $("birth");
  const canvas = $("birth-canvas");
  const form = $("birth-form");
  const skip = $("birth-skip");
  root.hidden = false;
  form.hidden = true;
  $("birth-line").textContent = "";
  document.body.classList.add("birthing");

  let stopFilm = () => {};
  let score = null;
  let globe = null;
  let globeCanvas = null;
  let ended = false;
  const extras = [];
  const alive = () => !ended && !root.classList.contains("asking");
  const add = (node) => (extras.push(node), root.append(node), node);

  const stop = () => {
    stopFilm();
    stopFilm = () => {};
    score?.close();
    score = null;
  };

  const showWorld = () => {
    if (globeCanvas) return;
    globeCanvas = el("canvas", { class: "birth-globe", "aria-hidden": "true" });
    root.append(globeCanvas);
    try {
      globe = createGlobe(globeCanvas, { seed: state.currentUser?.id || "panalo", maxDisk: 260 });
      globe.setLayers({ land: 0.07, clouds: 0.05, atmosphere: 0.35, forest: 0.3 });
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(() => globeCanvas.classList.add("in"));
  };

  const end = () => {
    if (ended) return;
    ended = true;
    stop();
    globe?.destroy();
    globeCanvas?.remove();
    root.classList.add("leaving");
    setTimeout(() => {
      extras.forEach((n) => n.remove());
      root.hidden = true;
      root.classList.remove("leaving", "asking", "cinema", "locked");
      document.body.classList.remove("birthing");
      onDone();
    }, reducedMotion() ? 0 : 700);
  };

  const ask = () => {
    if (replay) return end();
    stop();
    extras.forEach((n) => n.remove());
    extras.length = 0;
    root.classList.remove("cinema", "locked");
    root.classList.add("asking");
    showWorld();
    line(`Universe № ${(state.currentUser?.id || "0000").slice(0, 4).toUpperCase()} · age 0 seconds`, { low: false });
    form.hidden = false;
    skip.hidden = true;
    buildForm(form, { onDone: end });
  };

  skip.hidden = false;
  skip.textContent = replay ? "Close" : "Skip";
  skip.onclick = () => (replay ? end() : ask());

  if (reducedMotion() || !canvas.getContext) {
    line("Before this, there was nothing.").then(() => setTimeout(ask, 1200));
    return;
  }

  // The parts of the film that are words: an observer's log in the corner,
  // a countdown, the age of the universe as it passes, and a lock-on when
  // the world is found. All decoration; the narration line is what screen
  // readers hear.
  const hud = add(el("div", { class: "birth-hud", "aria-hidden": "true" }, [el("p"), el("p"), el("p")]));
  const age = add(el("p", { class: "birth-age", "aria-hidden": "true" }));
  const count = add(el("div", { class: "birth-count", "aria-hidden": "true" }));
  const reticle = add(el("div", { class: "birth-reticle", "aria-hidden": "true" }, [el("i"), el("i"), el("i"), el("i"), el("span")]));
  const [log1, log2, log3] = hud.children;

  score = createScore();
  if (score) {
    const sound = add(el("button", { type: "button", class: "btn btn-quiet btn-sm birth-sound" }));
    const label = () => {
      const on = !score?.muted;
      sound.textContent = on ? "Sound on" : "Sound off";
      sound.setAttribute("aria-pressed", String(on));
    };
    sound.addEventListener("click", () => {
      if (!score) return;
      score.setMuted(!score.muted);
      setSoundWanted(!score.muted);
      label();
    });
    label();
    score.resume();
  }

  const handle = `@${state.currentUsername || "you"}`;
  const tick = (n, high) => () => {
    count.replaceChildren(el("span", { text: String(n) }));
    score?.tick(high);
  };
  const stamp = (text) => () => {
    age.classList.remove("on");
    requestAnimationFrame(() => {
      age.textContent = text;
      age.classList.add("on");
    });
  };
  const cues = [
    { at: 0, run: () => typeInto(log1, "PANALO DEEP FIELD · OBSERVATION LOG 0001", alive) },
    { at: 350, run: () => line("Before this, there was nothing.") },
    { at: 520, run: () => typeInto(log2, `OBSERVER   ${handle}`, alive) },
    { at: 900, run: () => typeInto(log3, "TARGET     one universe · not yet begun", alive) },
    { at: 1150, run: () => line("") },
    { at: 1500, run: () => (tick(3)(), score?.drone(2.75)) },
    { at: 2400, run: tick(2) },
    { at: 3300, run: tick(1, true) },
    {
      at: IGNITION,
      run: () => {
        count.replaceChildren();
        score?.boom();
        score?.whoosh(3.4);
        log3.textContent = "TARGET     one universe · begun";
        stamp("10⁻³² s · inflation")();
      },
    },
    { at: 4700, run: () => line("Then — everything, all at once.") },
    { at: 5150, run: stamp("3 minutes · the first nuclei") },
    { at: 6000, run: stamp("380,000 years · first light") },
    { at: 6300, run: () => score?.shimmer(7) },
    { at: 7000, run: stamp("200 million years · the first stars") },
    { at: 7300, run: () => line("Stars learned to burn. Dust learned to hold on.") },
    { at: 8600, run: stamp("9 billion years · dust becomes worlds") },
    { at: 9400, run: showWorld },
    { at: 10200, run: () => line("Somewhere in the dust, a world is forming.", { low: true }) },
    {
      at: 12200,
      run: () => {
        root.classList.add("locked");
        score?.chime();
        stamp("today · you")();
        typeInto(reticle.querySelector("span"), "WORLD ACQUIRED · ORBIT STABLE · POPULATION 1", alive);
        line("Signal acquired. It's yours.", { low: true });
      },
    },
    { at: LENGTH, run: () => !ended && (replay ? end() : ask()) },
  ];

  root.classList.add("cinema");
  try {
    stopFilm = runSequence(canvas, state.currentUser?.id, cues);
  } catch (e) {
    console.error(e);
    return ask();
  }
}

export function needsBirth() {
  return !store.student && !store.schemaMissing;
}
