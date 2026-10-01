// Effects, in the language of hand-drawn action animation: speed lines that
// converge on a hit, an impact frame, ink that slashes a section open,
// elemental ribbons (water and flame) that wind around a world, and drifting
// petals and embers. All original drawing; no assets.
//
// Rules every effect follows:
//   - nothing runs with reduced motion (the OS setting or Settings);
//   - nothing runs in the Study Room, which stays calm on purpose;
//   - canvases are sized to the screen at <= 1.5x, stop when hidden, and
//     only exist while something is drawing on them;
//   - no full-screen flash is brighter than a soft white, or repeats faster
//     than once a second (photosensitivity).
import { reducedMotion, animationLoop } from "./motion.js";

export const calm = () => reducedMotion() || document.body.dataset.view === "study";

// ---- Speed lines -----------------------------------------------------------------

let burstCanvas = null;
let bursts = [];
let burstRaf = 0;

function burstLayer() {
  if (burstCanvas) return burstCanvas;
  burstCanvas = document.createElement("canvas");
  burstCanvas.className = "fx-burst";
  burstCanvas.setAttribute("aria-hidden", "true");
  document.body.append(burstCanvas);
  return burstCanvas;
}

function drawBursts(t) {
  burstRaf = 0;
  const c = burstCanvas;
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
  if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  bursts = bursts.filter((b) => t - b.t0 < b.dur);
  for (const b of bursts) {
    const q = (t - b.t0) / b.dur; // 0..1
    const ease = 1 - (1 - q) ** 3;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.globalCompositeOperation = "lighter";
    for (const l of b.lines) {
      // Lines rush in from beyond the reach towards the gap, then thin out.
      const outer = b.reach * (1.15 - 0.25 * ease) * l.len;
      const inner = b.gap + (outer - b.gap) * (0.15 + 0.85 * ease) * l.cut;
      const width = l.w * (1 - q);
      if (width <= 0.05) continue;
      ctx.strokeStyle = b.color.replace("A", String((1 - q) * l.a));
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(Math.cos(l.a0) * outer, Math.sin(l.a0) * outer);
      ctx.lineTo(Math.cos(l.a0) * inner, Math.sin(l.a0) * inner);
      ctx.stroke();
    }
    if (b.ring) {
      ctx.strokeStyle = b.color.replace("A", String(0.7 * (1 - q)));
      ctx.lineWidth = 3 * (1 - q) + 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, b.gap * 0.6 + ease * b.reach * 0.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (bursts.length) burstRaf = requestAnimationFrame(drawBursts);
  else ctx.clearRect(0, 0, w, h);
}

/**
 * Manga speed lines converging on (x, y) in viewport pixels.
 * @param {{reach?: number, gap?: number, count?: number, dur?: number, color?: string, ring?: boolean}} o
 */
export function speedLines(x, y, o = {}) {
  if (calm()) return;
  burstLayer();
  const count = o.count ?? 46;
  bursts.push({
    x, y,
    t0: performance.now(),
    dur: o.dur ?? 420,
    reach: o.reach ?? Math.hypot(window.innerWidth, window.innerHeight) * 0.6,
    gap: o.gap ?? 40,
    ring: o.ring ?? false,
    color: o.color ?? "rgba(235,242,255,A)",
    lines: Array.from({ length: count }, (_, i) => ({
      a0: (i / count) * Math.PI * 2 + Math.random() * 0.12,
      len: 0.6 + Math.random() * 0.5,
      cut: 0.4 + Math.random() * 0.6,
      w: 0.6 + Math.random() * 2.6,
      a: 0.35 + Math.random() * 0.6,
    })),
  });
  if (!burstRaf) burstRaf = requestAnimationFrame(drawBursts);
}

// A burst centred on an element.
export function burstOn(elm, o = {}) {
  const r = elm.getBoundingClientRect();
  speedLines(r.left + r.width / 2, r.top + r.height / 2, { gap: Math.max(r.width, r.height) * 0.55, reach: Math.max(160, Math.max(r.width, r.height) * 2.4), count: 30, dur: 360, ...o });
}

// ---- Impact frame ---------------------------------------------------------------------
// One hard frame of inverted ink, the way a hit lands in hand-drawn action.
let lastImpact = 0;
export function impactFrame({ strong = false } = {}) {
  if (calm()) return;
  const now = performance.now();
  if (now - lastImpact < 1000) return; // never more than once a second
  lastImpact = now;
  const f = document.createElement("div");
  f.className = `fx-impact${strong ? " strong" : ""}`;
  f.setAttribute("aria-hidden", "true");
  document.body.append(f);
  f.addEventListener("animationend", () => f.remove(), { once: true });
  setTimeout(() => f.remove(), 800);
}

// A short punch on an element: scale, settle, with afterimages.
export function punch(elm) {
  if (calm() || !elm) return;
  elm.classList.remove("fx-punch");
  void elm.offsetWidth;
  elm.classList.add("fx-punch");
  setTimeout(() => elm.classList.remove("fx-punch"), 500);
}

// ---- Ink reveals ----------------------------------------------------------------------
// Elements marked data-fx get .fx-in when they scroll into view; the CSS
// decides what that looks like (a slash wipe, a brush stroke drawing itself,
// a rise). Without IntersectionObserver, or with reduced motion, everything
// is simply shown.
let revealer = null;
export function reveal(root = document) {
  const items = root.querySelectorAll("[data-fx]:not(.fx-in)");
  if (reducedMotion() || !("IntersectionObserver" in window)) {
    items.forEach((n) => n.classList.add("fx-in"));
    return;
  }
  revealer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("fx-in");
        revealer.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
  );
  items.forEach((n) => revealer.observe(n));
}

// ---- Elemental ribbons ----------------------------------------------------------------
// Two ribbons orbit a world: water (layered blues, a white crest and foam
// curls at its head, like a woodblock wave) and flame (red to gold, licking
// outward). Each is a tapered brush stroke drawn in three passes: ink
// outline, colour, highlight. The half behind the world goes on `back`,
// the half in front on `front`.
export function ribbons(back, front, { getMotion } = {}) {
  if (reducedMotion()) return { destroy() {} };
  const cb = back.getContext("2d"), cf = front.getContext("2d");
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  let w = 0, h = 0;
  const fit = () => {
    const r = back.getBoundingClientRect();
    w = r.width;
    h = r.height;
    for (const c of [back, front]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
  };
  fit();
  const ro = "ResizeObserver" in window ? new ResizeObserver(fit) : null;
  ro?.observe(back);

  const kinds = [
    { name: "water", tilt: -0.42, roll: 0.18, rx: 0.47, ry: 0.13, len: 2.3, width: 0.05, speed: 0.55, phase: 0 },
    { name: "flame", tilt: 0.5, roll: -0.25, rx: 0.44, ry: 0.11, len: 1.9, width: 0.045, speed: -0.42, phase: Math.PI },
  ];
  let e = 0;
  const loop = animationLoop(back, (t, dt) => {
    const m = getMotion?.() || { speed: 1, direction: 1, paused: false };
    const k = m.paused ? 0.15 : 0.5 + 0.5 * Math.min(4, m.speed);
    e += (dt / 1000) * k * (m.direction || 1);
    for (const c of [cb, cf]) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
    }
    const S = Math.min(w, h);
    for (const r of kinds) drawRibbon(r, e, t / 1000, S);
  });
  loop.start();

  function drawRibbon(r, e, time, S) {
    const head = r.phase + e * r.speed * 2.2;
    const N = 70;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N; // 0 = head, 1 = tail
      const th = head - Math.sign(r.speed || 1) * u * r.len;
      // A wobble along the length: water undulates, flame flickers.
      const wob = r.name === "water" ? Math.sin(th * 3 + time * 2) * 0.018 : Math.sin(th * 7 + time * 9) * 0.012 * (1 - u);
      const x0 = Math.cos(th) * (r.rx + wob), y0 = Math.sin(th) * (r.ry + wob * 0.5);
      // Tilt the orbit in the plane of the screen and tip it away.
      const ct = Math.cos(r.tilt), st = Math.sin(r.tilt);
      const x = x0 * ct - y0 * st, y = x0 * st + y0 * ct;
      const depth = Math.sin(th + r.roll); // > 0: in front of the world
      const taper = Math.sin(Math.min(1, u * 1.15) * Math.PI) ** 0.7 * (1 - u * 0.35);
      pts.push({ x: w / 2 + x * S, y: h / 2 + y * S, depth, wd: r.width * S * taper * (0.75 + 0.25 * depth), u });
    }
    // Split into runs by depth so each half lands on its own canvas.
    let run = [];
    const flush = () => {
      if (run.length > 1) stroke(run[0].depth > 0 ? cf : cb, run, r, time);
      run = run.slice(-1);
    };
    for (let i = 0; i < pts.length; i++) {
      if (run.length && (run[run.length - 1].depth > 0) !== (pts[i].depth > 0)) flush();
      run.push(pts[i]);
    }
    flush();
    // The head: a curl of foam, or a burst of sparks.
    const hp = pts[0];
    const c = hp.depth > 0 ? cf : cb;
    if (r.name === "water") curl(c, hp, pts[3], time, S);
    else sparks(c, pts, time, S);
  }

  function outline(run, scale) {
    // A closed shape around the centre line, offset by half the width.
    const left = [], right = [];
    for (let i = 0; i < run.length; i++) {
      const a = run[Math.max(0, i - 1)], b = run[Math.min(run.length - 1, i + 1)];
      let nx = -(b.y - a.y), ny = b.x - a.x;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const hw = (run[i].wd * scale) / 2;
      left.push([run[i].x + nx * hw, run[i].y + ny * hw]);
      right.push([run[i].x - nx * hw, run[i].y - ny * hw]);
    }
    return left.concat(right.reverse());
  }
  function fillPoly(c, poly) {
    c.beginPath();
    poly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  }

  function stroke(c, run, r, time) {
    if (r.name === "water") {
      c.fillStyle = "rgba(6,18,48,0.85)"; // ink outline
      fillPoly(c, outline(run, 1.25));
      const g = c.createLinearGradient(run[0].x, run[0].y, run[run.length - 1].x, run[run.length - 1].y);
      g.addColorStop(0, "rgba(120,200,255,0.95)");
      g.addColorStop(0.5, "rgba(40,120,230,0.9)");
      g.addColorStop(1, "rgba(30,80,200,0.0)");
      c.fillStyle = g;
      fillPoly(c, outline(run, 1));
      c.fillStyle = "rgba(235,250,255,0.85)"; // the crest
      fillPoly(c, outline(run.map((p) => ({ ...p, wd: p.wd * (0.25 + 0.12 * Math.sin(p.u * 30 + time * 6)) })), 1));
    } else {
      c.globalCompositeOperation = "source-over";
      c.fillStyle = "rgba(40,6,0,0.8)";
      fillPoly(c, outline(run, 1.25));
      const g = c.createLinearGradient(run[0].x, run[0].y, run[run.length - 1].x, run[run.length - 1].y);
      g.addColorStop(0, "rgba(255,240,170,1)");
      g.addColorStop(0.25, "rgba(255,150,40,0.95)");
      g.addColorStop(0.7, "rgba(220,40,20,0.8)");
      g.addColorStop(1, "rgba(160,20,10,0)");
      c.fillStyle = g;
      // Tongues: the width flickers along the length.
      fillPoly(c, outline(run.map((p) => ({ ...p, wd: p.wd * (0.85 + 0.35 * Math.max(0, Math.sin(p.u * 40 - time * 14))) })), 1));
      c.globalCompositeOperation = "lighter";
      c.fillStyle = "rgba(255,230,150,0.55)";
      fillPoly(c, outline(run.map((p) => ({ ...p, wd: p.wd * 0.3 })), 1));
      c.globalCompositeOperation = "source-over";
    }
  }

  function curl(c, hp, next, time, S) {
    const ang = Math.atan2(hp.y - next.y, hp.x - next.x);
    const R = Math.max(4, hp.wd * 0.9 + S * 0.012);
    c.save();
    c.translate(hp.x, hp.y);
    c.rotate(ang);
    c.lineCap = "round";
    for (let k = 0; k < 3; k++) {
      c.strokeStyle = k === 0 ? "rgba(6,18,48,0.85)" : k === 1 ? "rgba(90,170,250,0.95)" : "rgba(240,252,255,0.95)";
      c.lineWidth = k === 0 ? R * 0.55 : k === 1 ? R * 0.38 : R * 0.14;
      c.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2.2 + time * 2;
        const rr = R * (1 - i / 48);
        const x = Math.cos(a) * rr + R * 0.4, y = Math.sin(a) * rr * 0.9;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
    // Foam: little white beads thrown off the crest.
    c.fillStyle = "rgba(240,252,255,0.9)";
    for (let i = 0; i < 6; i++) {
      const a = time * 3 + i * 1.3;
      c.beginPath();
      c.arc(R * 1.3 + Math.cos(a) * R * 0.8, Math.sin(a * 1.7) * R * 0.9, R * 0.08 * (1 + (i % 3)), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  function sparks(c, pts, time, S) {
    c.save();
    c.globalCompositeOperation = "lighter";
    for (let i = 0; i < 16; i++) {
      const p = pts[(i * 3) % 30];
      const life = (time * 1.6 + i * 0.37) % 1;
      const x = p.x + Math.sin(i * 12.9 + time) * S * 0.03 * life;
      const y = p.y - life * S * 0.06;
      c.fillStyle = `rgba(255,${180 + (i % 3) * 25},90,${(1 - life) * 0.9})`;
      c.beginPath();
      c.arc(x, y, 1.2 + (1 - life) * 1.8, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  return {
    destroy() {
      loop.destroy();
      ro?.disconnect();
    },
  };
}

// ---- Petals and embers -----------------------------------------------------------------
// A light drift across a canvas: pink petals tumbling, or embers rising.
export function drift(canvas, { count = 28, kinds = ["petal", "ember"], wind = 1 } = {}) {
  if (reducedMotion()) return { destroy() {}, setPaused() {} };
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  let w = 0, h = 0;
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    w = r.width || window.innerWidth;
    h = r.height || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };
  fit();
  window.addEventListener("resize", fit);
  const spawn = (p, anywhere) => {
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    Object.assign(p, {
      kind,
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : kind === "ember" ? h + 10 : -10,
      s: kind === "petal" ? 4 + Math.random() * 5 : 1 + Math.random() * 2,
      vx: (Math.random() - 0.3) * 20 * wind,
      vy: kind === "ember" ? -(14 + Math.random() * 26) : 16 + Math.random() * 22,
      a: Math.random() * Math.PI * 2,
      va: (Math.random() - 0.5) * 3,
      flip: Math.random() * Math.PI * 2,
    });
    return p;
  };
  const parts = Array.from({ length: count }, () => spawn({}, true));
  let paused = false;
  const loop = animationLoop(canvas, (t, dt) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (paused) return;
    const s = dt / 1000;
    for (const p of parts) {
      p.x += (p.vx + Math.sin(t / 900 + p.flip) * 12 * wind) * s;
      p.y += p.vy * s;
      p.a += p.va * s;
      p.flip += s * 3;
      if (p.y > h + 20 || p.y < -20 || p.x < -30 || p.x > w + 30) spawn(p, false);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      if (p.kind === "petal") {
        ctx.scale(1, Math.abs(Math.cos(p.flip)) * 0.8 + 0.2);
        ctx.fillStyle = "rgba(255,170,200,0.7)";
        ctx.beginPath();
        ctx.moveTo(0, -p.s);
        ctx.quadraticCurveTo(p.s, -p.s * 0.2, 0, p.s);
        ctx.quadraticCurveTo(-p.s, -p.s * 0.2, 0, -p.s);
        ctx.fill();
        ctx.fillStyle = "rgba(255,230,240,0.6)";
        ctx.fillRect(-0.5, -p.s * 0.6, 1, p.s * 0.9);
      } else {
        ctx.fillStyle = "rgba(255,170,80,0.85)";
        ctx.shadowColor = "rgba(255,120,40,0.9)";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(0, 0, p.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  });
  loop.start();
  return {
    setPaused(v) {
      paused = v;
    },
    destroy() {
      loop.destroy();
      window.removeEventListener("resize", fit);
    },
  };
}
