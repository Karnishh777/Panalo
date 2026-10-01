// "Origin" -- the film that plays once, when a universe is born.
//
// Four shots, about 26 seconds, then the film holds behind the questions:
//   1. The void      a slow push through dust towards one point of light.
//                     A heartbeat; a riser; then a cut to black and silence.
//   2. Genesis        the bang -- white-out, shockwave, god rays -- and a
//                     flight out through new stars and three nebulae.
//   3. Worldfall      a disk of dust falls into your actual world (the same
//                     seed as your World page); the sun rises over its limb.
//   4. Title          PANALO, and your universe's number.
//
// Each frame is drawn on a scene canvas, your world is rendered into it,
// and the whole frame goes through film-grade.js (LUT grading, bloom,
// halation, anamorphic streaks, grain, 2.39:1). Sound and voice-over come
// from birth-score.js; captions always show.
//
// Without WebGL the same film plays ungraded, with the world drawn by the
// 2D renderer on top. Reduced motion never starts it (birth.js).
import { animationLoop } from "./motion.js";
import { createGrader, LUT } from "./film-grade.js";
import { createGlobeGL, glSupported } from "./world-gl.js";

export const IGNITION = 8650;
export const WORLDFALL = 15500;
export const TITLE = 22000;
export const LENGTH = 26500;

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x, a, b) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

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

// A nebula, painted once: glowing gas along a curved band, filaments, dark
// dust lanes, embedded stars. Three of these at different depths make the
// flight-through.
function paintPlate(rand, palette, W = 900, H = 560) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const ph = rand() * 6, amp = 0.18 + rand() * 0.14;
  const band = (u) => H * (0.5 + amp * Math.sin(u * 3.1 + ph));
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 70; i++) {
    const u = rand();
    const x = W * (0.04 + 0.92 * u), y = band(u) + (rand() - 0.5) * H * 0.35;
    const r = H * (0.06 + rand() * 0.3);
    const [cr, cg, cb] = palette[Math.floor(rand() * palette.length)];
    const a = 0.03 + rand() * 0.08;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
    grad.addColorStop(0.55, `rgba(${cr},${cg},${cb},${a * 0.35})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Filaments: thin bright threads of gas.
  g.lineCap = "round";
  for (let i = 0; i < 14; i++) {
    const [cr, cg, cb] = palette[Math.floor(rand() * palette.length)];
    const x0 = W * rand(), y0 = band(x0 / W) + (rand() - 0.5) * H * 0.3;
    g.strokeStyle = `rgba(${cr},${cg},${cb},${0.015 + rand() * 0.03})`;
    g.lineWidth = 4 + rand() * 14;
    g.shadowColor = `rgba(${cr},${cg},${cb},0.35)`;
    g.shadowBlur = 30;
    g.beginPath();
    g.moveTo(x0, y0);
    g.bezierCurveTo(x0 + (rand() - 0.5) * 300, y0 + (rand() - 0.5) * 200, x0 + (rand() - 0.5) * 400, y0 + (rand() - 0.5) * 200, x0 + (rand() - 0.5) * 500, y0 + (rand() - 0.5) * 160);
    g.stroke();
  }
  g.shadowBlur = 0;
  // Dust lanes.
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 22; i++) {
    const u = rand();
    const x = W * u, y = band(u) + (rand() - 0.5) * H * 0.12;
    const r = 18 + rand() * 70;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Young stars inside the gas.
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 160; i++) {
    const u = rand();
    const x = W * u, y = band(u) + (rand() - 0.5) * H * 0.5;
    const r = rand() < 0.08 ? 2 + rand() * 2.5 : 0.6 + rand() * 0.9;
    const grad = g.createRadialGradient(x, y, 0, x, y, r * 3);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.3, "rgba(220,235,255,0.4)");
    grad.addColorStop(1, "rgba(200,220,255,0)");
    g.fillStyle = grad;
    g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  }
  return c;
}

/**
 * @param {HTMLElement} host        where the film's canvas goes
 * @param {{seed: string, layers: object, cues: Array<{at: number, run: Function}>, plates?: object|Promise<object>, onFallbackWorld?: Function}} opts
 *   plates: optional video plates by shot ({void, genesis, worldfall}), from
 *   media/film.json -- filmed backgrounds that go through the same grade.
 */
export function createFilm(host, { seed, layers, cues = [], plates = {}, onFallbackWorld } = {}) {
  const out = document.createElement("canvas");
  out.className = "film-out";
  out.setAttribute("aria-hidden", "true");
  host.prepend(out);

  const useGL = glSupported();
  const grader = useGL ? createGrader(out) : null;
  const scene = grader ? document.createElement("canvas") : out;
  const ctx = scene.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");

  // Your world, rendered into the film (WebGL), or on top of it (2D).
  let globe = null;
  if (useGL) {
    const gc = document.createElement("canvas");
    gc.width = gc.height = 1024;
    globe = createGlobeGL(gc, { seed, manual: true, maxPixels: 1024 });
    globe?.setLayers(layers);
  }

  let w = 0, h = 0, S = 0;
  const resize = () => {
    w = Math.max(1, host.clientWidth || window.innerWidth);
    h = Math.max(1, host.clientHeight || window.innerHeight);
    S = Math.min(w, h);
    if (grader) {
      const [W, H] = grader.sceneSize(w, h);
      scene.width = W;
      scene.height = H;
    } else {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      scene.width = Math.round(w * dpr);
      scene.height = Math.round(h * dpr);
    }
    // Where the bars are, for captions to sit in.
    const barFrac = Math.max(0, (1 - Math.min(1, (w / h) / 2.39)) / 2);
    host.style.setProperty("--film-bar", `${Math.round(barFrac * h)}px`);
  };
  resize();
  window.addEventListener("resize", resize);

  const rand = seeded(seed || "panalo");
  const nebulae = [
    paintPlate(rand, [[40, 120, 255], [60, 200, 230], [120, 90, 255]]),
    paintPlate(rand, [[255, 80, 160], [180, 70, 255], [255, 140, 200]]),
    paintPlate(rand, [[255, 170, 80], [255, 110, 60], [255, 220, 150]]),
  ];
  const star = (z) => {
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 1.6;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, z, tw: Math.random() * TAU, warm: Math.random() < 0.3, big: Math.random() < 0.04 };
  };
  const big = w * h > 500000;
  const stars = Array.from({ length: big ? 700 : 360 }, () => star(0.05 + Math.random() * 0.95));
  const bokeh = Array.from({ length: 9 }, () => ({ x: Math.random(), y: Math.random(), r: 0.025 + Math.random() * 0.07, s: 0.2 + Math.random() * 0.6, hue: Math.random() }));
  const disk = Array.from({ length: big ? 900 : 420 }, () => ({ th: Math.random() * TAU, r: 0, band: Math.random(), size: 0.5 + Math.random() * 1.6, warm: Math.random() }));

  // Video plates: muted, inline, preloaded; each starts with its shot. A
  // plate that hasn't loaded in time is simply not drawn.
  const videos = {};
  const SHOT_START = { void: 0, genesis: IGNITION, worldfall: WORLDFALL - 600 };
  Promise.resolve(plates).then((p) => {
    for (const k of Object.keys(SHOT_START)) {
      if (!p?.[k] || stopped) continue;
      const v = document.createElement("video");
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.preload = "auto";
      v.loop = k === "worldfall";
      v.src = p[k];
      videos[k] = { v, started: false };
    }
  });
  function plate(name, e, alpha = 1) {
    const p = videos[name];
    if (!p) return false;
    if (!p.started && (e >= SHOT_START[name] || holding)) {
      p.started = true;
      p.v.play().catch(() => {});
    }
    if (!p.started || p.v.readyState < 2 || alpha <= 0) return false;
    // Cover the frame, centred: the subject stays in the middle on any screen.
    const vw = p.v.videoWidth || 16, vh = p.v.videoHeight || 9;
    const k = Math.max(w / vw, h / vh);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(p.v, (w - vw * k) / 2, (h - vh * k) / 2, vw * k, vh * k);
    ctx.restore();
    return true;
  }
  function drawPlates(e) {
    if (holding) return plate("worldfall", e);
    const a = e - IGNITION;
    let any = false;
    if (e < 8200) any = plate("void", e, smooth(e, 0, 1500)) || any;
    if (a >= 0) any = plate("genesis", e, 1 - smooth(e, WORLDFALL - 600, WORLDFALL + 600)) || any;
    if (e >= WORLDFALL - 600) any = plate("worldfall", e, smooth(e, WORLDFALL - 600, WORLDFALL + 600)) || any;
    return any;
  }
  let stopped = false;
  let filmed = false; // a plate is on screen: the drawn nebulae step back

  const queue = [...cues].sort((a, b) => a.at - b.at);
  let e = 0;
  // For reviewing the film on slow machines: localStorage
  // "panalo.students.filmrate" plays it faster (2 = double speed).
  let rate = 1;
  try {
    rate = Math.max(0.25, Math.min(8, Number(localStorage.getItem("panalo.students.filmrate")) || 1));
  } catch {}
  let holding = false;
  let holdAt = 0;
  let speedAcc = 0;

  // ---- the camera's light: per-shot grade and exposure --------------------------------
  function grade(e) {
    const a = e - IGNITION;
    let A = LUT.void, B = LUT.void, mix = 0, exposure = 1, bloom = 0.7, streak = 0.4, aberr = 0.012;
    if (e < IGNITION) {
      exposure = smooth(e, 0, 2600) * (1 + 0.6 * smooth(e, 6200, 8150));
      streak = 0.4 + 1.2 * smooth(e, 5000, 8150);
      bloom = 0.7 + 0.8 * smooth(e, 6000, 8150);
      if (e > 8200) exposure = 0; // the cut to black
    } else {
      A = LUT.ignition;
      B = LUT.nebula;
      mix = smooth(a, 1200, 3800);
      exposure = 1 + 2.4 * (1 - smooth(a, 0, 1400));
      bloom = 1 + 1.4 * (1 - smooth(a, 0, 2400));
      streak = 0.5 + 1.4 * (1 - smooth(a, 0, 2600));
      aberr = 0.012 + 0.05 * (1 - smooth(a, 0, 1500));
      if (e > WORLDFALL - 600) {
        A = LUT.nebula;
        B = LUT.gold;
        mix = smooth(e, WORLDFALL - 600, WORLDFALL + 2400);
        exposure = 1;
        bloom = 0.9;
        streak = 0.6;
      }
    }
    if (holding) {
      A = LUT.gold;
      B = LUT.gold;
      exposure *= 0.88;
    }
    return { a: A, b: B, mix, exposure, bloom, streak, aberr, grain: 0.07, time: e / 1000, bars: holding ? 1 - smooth(e - holdAt, 0, 1200) : 1, vignette: 0.85 };
  }

  // ---- drawing ------------------------------------------------------------------------
  function drawStars(e, dt) {
    const a = e - IGNITION;
    // Camera speed through the field: a crawl in the void, a rush after
    // the bang that eases into drift.
    let v = e < IGNITION ? 0.000035 : 0.0016 * Math.exp(-a / 1300) + 0.00005;
    if (holding) v = 0.00002;
    speedAcc = v;
    const F = S * 0.42;
    const cx = w / 2, cy = h / 2;
    const fade = e < IGNITION ? smooth(e, 300, 3000) * 0.9 : 1;
    ctx.lineCap = "round";
    for (const st of stars) {
      const z0 = st.z;
      st.z -= v * dt;
      if (st.z <= 0.04) Object.assign(st, star(1));
      const x1 = cx + (st.x / st.z) * F, y1 = cy + (st.y / st.z) * F;
      const x0 = cx + (st.x / z0) * F, y0 = cy + (st.y / z0) * F;
      if (x1 < -20 || x1 > w + 20 || y1 < -20 || y1 > h + 20) continue;
      const near = 1 - st.z;
      const tw = 0.75 + 0.25 * Math.sin(e / 400 + st.tw);
      const al = Math.min(1, (0.25 + near * 1.1) * tw) * fade;
      ctx.strokeStyle = st.warm ? `rgba(255,214,170,${al})` : `rgba(210,228,255,${al})`;
      ctx.lineWidth = (st.big ? 1.8 : 0.7) + near * 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1 + 0.01, y1);
      ctx.stroke();
    }
  }

  function drawBokeh(e) {
    // Out-of-focus dust right in front of the lens, drifting.
    const fade = smooth(e, 600, 3200) * (1 - smooth(e, 7000, 8200));
    if (fade <= 0) return;
    for (const b of bokeh) {
      const x = ((b.x + e * 0.000012 * b.s) % 1.2 - 0.1) * w;
      const y = (b.y + Math.sin(e / 3000 + b.hue * 6) * 0.02) * h;
      const r = b.r * S;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${b.hue < 0.5 ? "150,190,255" : "255,200,160"},${0.035 * fade})`);
      g.addColorStop(0.8, `rgba(${b.hue < 0.5 ? "170,205,255" : "255,215,180"},${0.045 * fade})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  }

  function drawPoint(e) {
    // The one light in the void, swelling as the riser climbs.
    const grow = smooth(e, 1000, 8100);
    const shake = e > 5000 ? (Math.random() - 0.5) * 2 * smooth(e, 5000, 8100) : 0;
    const cx = w / 2 + shake, cy = h / 2 + shake * 0.6;
    const r = S * (0.004 + 0.02 * grow * grow) * (1 + 0.08 * Math.sin(e / 90));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 9);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.08, "rgba(255,246,230,0.95)");
    g.addColorStop(0.3, `rgba(255,190,130,${0.25 + 0.3 * grow})`);
    g.addColorStop(1, "rgba(120,150,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r * 9, cy - r * 9, r * 18, r * 18);
  }

  function drawNebulae(e) {
    const a = e - IGNITION;
    const open = holding ? 0.55 : smooth(a, 600, 3600) * (1 - 0.45 * smooth(e, WORLDFALL, WORLDFALL + 4000));
    if (open <= 0) return;
    nebulae.forEach((p, i) => {
      // Fly through: each plate grows past the camera at its own depth.
      const depth = 1 + i * 0.6;
      const k = (holding ? 1.1 : 0.9 + (a / 1000) * 0.06 / depth) * (1 + i * 0.25);
      const D = Math.hypot(w, h) * k;
      ctx.save();
      ctx.globalAlpha = open * (i === 2 ? 0.7 : 0.85) * (filmed ? 0.3 : 1);
      ctx.translate(w / 2 + Math.sin(e / 9000 + i) * w * 0.04, h / 2 + Math.cos(e / 11000 + i) * h * 0.04);
      ctx.rotate(e * 0.000012 * (i % 2 ? -1 : 1) + i * 1.9);
      ctx.drawImage(p, -D / 2, -D * 0.31, D, D * 0.62);
      ctx.restore();
    });
  }

  function drawRays(e) {
    const a = e - IGNITION;
    const k = smooth(a, 0, 400) * (1 - smooth(a, 2500, 7000));
    if (k <= 0) return;
    const cx = w / 2, cy = h / 2, R = Math.hypot(w, h);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a * 0.00004);
    // Volumetric light through the debris: many thin, faint shafts in two
    // soft layers, so no edge reads as a drawn line.
    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * TAU + Math.sin(i * 7.3) * 0.35;
      const strength = 0.4 + 0.6 * Math.abs(Math.sin(i * 2.17 + 1));
      for (const [wdt, al] of [[0.006 + 0.012 * Math.abs(Math.sin(i * 3.7)), 0.06], [0.025 + 0.02 * Math.abs(Math.sin(i * 1.3)), 0.025]]) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * (0.5 + 0.5 * strength));
        g.addColorStop(0, `rgba(255,236,200,${al * k * strength})`);
        g.addColorStop(1, "rgba(255,200,150,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, ang - wdt, ang + wdt);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawBang(e) {
    const a = e - IGNITION;
    if (a < 0 || a > 3200) return;
    const cx = w / 2, cy = h / 2;
    if (a < 900) {
      ctx.fillStyle = `rgba(255,250,240,${(1 - a / 900) ** 1.6})`;
      ctx.fillRect(0, 0, w, h);
    }
    // The fireball and its cooling core.
    const q = clamp01(a / 3200);
    const R = S * (0.05 + 0.5 * (1 - (1 - q) ** 3));
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    core.addColorStop(0, `rgba(255,255,255,${1 - q})`);
    core.addColorStop(0.25, `rgba(255,220,160,${0.7 * (1 - q)})`);
    core.addColorStop(0.6, `rgba(255,120,60,${0.25 * (1 - q)})`);
    core.addColorStop(1, "rgba(80,40,120,0)");
    ctx.fillStyle = core;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    // Shockwave: a thin ring racing out.
    const sr = S * 0.06 + (1 - (1 - clamp01(a / 2200)) ** 3) * Math.hypot(w, h) * 0.6;
    if (a < 2200) {
      ctx.strokeStyle = `rgba(220,235,255,${0.7 * (1 - a / 2200)})`;
      ctx.lineWidth = 1 + 8 * (1 - a / 2200);
      ctx.beginPath();
      ctx.ellipse(cx, cy, sr, sr * 0.92, 0, 0, TAU);
      ctx.stroke();
    }
  }

  function drawDisk(e, dt) {
    const gather = smooth(e, WORLDFALL - 1500, WORLDFALL + 1500);
    const fall = smooth(e, WORLDFALL + 1500, WORLDFALL + 5000);
    const alpha = gather * (1 - smooth(e, WORLDFALL + 3500, WORLDFALL + 6200));
    if (alpha <= 0) return;
    const { cx, cy } = worldFrame(e);
    for (const m of disk) {
      const target = S * (0.21 + m.band * (0.36 - 0.17 * fall));
      if (!m.r) m.r = S * (0.7 + m.band * 0.5);
      m.r += (target - m.r) * (1 - Math.exp(-dt / 900));
      m.th += dt * 0.0009 * Math.pow((S * 0.25) / m.r, 1.5);
      const x = cx + Math.cos(m.th) * m.r, y = cy + Math.sin(m.th) * m.r * 0.22;
      const inner = 1 - m.band;
      ctx.fillStyle = m.warm < 0.55
        ? `rgba(255,${Math.round(160 + 70 * inner)},${Math.round(100 + 90 * inner)},${alpha * 0.85})`
        : `rgba(${Math.round(160 + 70 * inner)},${Math.round(190 + 40 * inner)},255,${alpha * 0.7})`;
      ctx.fillRect(x, y, m.size, m.size);
    }
  }

  // Where the world sits and how big it is: centre stage, slowly coming
  // closer; then up, to make room for the questions.
  function worldFrame(e) {
    const k = holding ? smooth(e - holdAt, 0, 1400) : 0;
    const dolly = 1 + 0.12 * smooth(e, WORLDFALL, TITLE + 3000);
    const size = lerp(S * 0.95 * dolly, Math.min(S * 0.78, h * 0.62), k);
    const cy = lerp(h / 2, Math.max(size * 0.36, h * 0.3), k);
    return { cx: w / 2, cy, size };
  }

  function drawWorld(e, t, dt) {
    if (!globe) return;
    const show = holding ? 1 : smooth(e, WORLDFALL + 400, WORLDFALL + 3200);
    if (show <= 0) return;
    // The sun comes round from behind: a sunrise over the limb.
    const sunA = holding ? -0.75 : lerp(2.75, -0.75, smooth(e, WORLDFALL + 800, TITLE + 1500));
    const sun = [Math.sin(sunA) * 0.95, 0.28, Math.cos(sunA) * 0.95];
    globe.setSun(sun, 0.06);
    globe.setView({ pitch: lerp(0.35, 0.05, smooth(e, WORLDFALL, TITLE)) });
    globe.frame(t, dt);
    const { cx, cy, size } = worldFrame(e);
    ctx.save();
    ctx.globalAlpha = show;
    ctx.drawImage(globe.canvas, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
    // The sunrise glare: where the sun sits just behind the limb.
    const R = size / 2 / 1.7;
    const behind = sun[2];
    const glare = show * smooth(behind, 0.55, 0.05) * smooth(behind, -0.5, -0.05);
    if (glare > 0.01) {
      const l = Math.hypot(sun[0], sun[1]) || 1;
      const gx = cx + (sun[0] / l) * R * 0.98, gy = cy - (sun[1] / l) * R * 0.98;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, R * 0.9);
      g.addColorStop(0, `rgba(255,255,255,${glare})`);
      g.addColorStop(0.05, `rgba(255,240,210,${glare * 0.9})`);
      g.addColorStop(0.3, `rgba(255,170,90,${glare * 0.25})`);
      g.addColorStop(1, "rgba(255,120,60,0)");
      ctx.fillStyle = g;
      ctx.fillRect(gx - R, gy - R, R * 2, R * 2);
    }
  }

  // ---- the loop -------------------------------------------------------------------------
  let fallbackShown = false;
  const loop = animationLoop(out, (t, frameDt) => {
    const dt = frameDt * rate;
    e += dt;
    while (queue.length && queue[0].at <= e) queue.shift().run();
    if (!globe && !fallbackShown && e > WORLDFALL + 400) {
      fallbackShown = true;
      onFallbackWorld?.();
    }
    const a = e - IGNITION;
    const shake = a > 0 && a < 900 ? 16 * (1 - a / 900) ** 2 : 0;
    ctx.setTransform(scene.width / w, 0, 0, scene.height / h, 0, 0);
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#010103";
    ctx.fillRect(-20, -20, w + 40, h + 40);
    filmed = drawPlates(e);

    if (e < 8200 && !holding) {
      drawStars(e, dt);
      drawBokeh(e);
      drawPoint(e);
    } else if (e >= IGNITION || holding) {
      ctx.globalCompositeOperation = "lighter";
      drawNebulae(e);
      drawRays(e);
      drawStars(e, dt);
      drawDisk(e, dt);
      ctx.globalCompositeOperation = "source-over";
      drawWorld(e, t, dt);
      ctx.globalCompositeOperation = "lighter";
      drawBang(e);
      ctx.globalCompositeOperation = "source-over";
    }
    if (grader) grader.render(scene, grade(e));
  });
  loop.start();

  return {
    get time() {
      return e;
    },
    /** Jump to the end state and keep a quiet, living backdrop going. */
    hold() {
      if (holding) return;
      if (e < WORLDFALL + 3000) {
        // Skipped early: arrive straight at the world.
        e = Math.max(e, TITLE + 2000);
        queue.length = 0;
        if (!globe && !fallbackShown) {
          fallbackShown = true;
          onFallbackWorld?.();
        }
      }
      holding = true;
      holdAt = e;
    },
    stop() {
      stopped = true;
      for (const { v } of Object.values(videos)) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
      loop.destroy();
      window.removeEventListener("resize", resize);
      globe?.destroy();
      grader?.destroy();
    },
    graded: !!grader,
    speed: () => speedAcc,
  };
}
