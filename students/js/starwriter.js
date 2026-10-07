// Writing in stars (batch 4): a word drawn as a constellation.
//
// The text is set once on a hidden canvas; points are sampled from the
// letters (a few hundred at most), and each becomes a star that flies in
// from the dark, left to right as if written, then settles, twinkles, and
// joins its neighbours with faint lines. Used for your name on the film's
// title, and your world's name at the end of the birth.
//
// Reduced motion: the finished constellation, drawn once.
import { reducedMotion } from "./motion.js";

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

/** Points on the letters of `text`, fitted to a w×h box, left to right. */
export function letterPoints(text, w, h, { font = "Unbounded, system-ui, sans-serif", max = 260, weight = 400 } = {}) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext("2d");
  let size = h * 0.78;
  g.font = `${weight} ${size}px ${font}`;
  const measured = g.measureText(text).width;
  if (measured > w * 0.94) size *= (w * 0.94) / measured;
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  g.fillText(text, w / 2, h / 2);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  // A grid step that yields about `max` points, whatever the text's length.
  let ink = 0;
  for (let i = 3; i < data.length; i += 16) if (data[i] > 128) ink++;
  const step = Math.max(2, Math.round(Math.sqrt((ink * 4) / max)));
  const pts = [];
  for (let y = 0; y < c.height; y += step) {
    for (let x = 0; x < c.width; x += step) {
      if (data[(y * c.width + x) * 4 + 3] > 128) pts.push({ x, y });
    }
  }
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  return { pts, step };
}

/**
 * Write `text` in stars on `canvas`. Resolves when written; keeps twinkling
 * until stop().
 */
export function writeInStars(canvas, text, { seed = text, duration = 2200, color = [255, 226, 184], font, weight } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { pts, step } = letterPoints(text, W, H, { font, weight });
  const rand = seeded(seed);
  const stars = pts.map((p, i) => ({
    ...p,
    // From somewhere in the dark around the word.
    sx: W / 2 + (rand() - 0.5) * W * 1.6,
    sy: H / 2 + (rand() - 0.5) * H * 4,
    delay: (p.x / W) * duration * 0.55 + rand() * 180,
    r: 0.6 + rand() * 1.1,
    tw: rand() * Math.PI * 2,
    i,
  }));
  // Lines between near neighbours, so the letters read as constellations.
  const links = [];
  const near = step * 1.6;
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length && stars[j].x - stars[i].x <= near; j++) {
      const dx = stars[j].x - stars[i].x;
      const dy = stars[j].y - stars[i].y;
      if (dx * dx + dy * dy <= near * near && rand() < 0.35) links.push([i, j]);
    }
  }
  const [cr, cg, cb] = color;
  const still = reducedMotion();
  let raf = 0;
  let stopped = false;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const t0 = performance.now();
  const fly = 900;

  function frame(t) {
    const e = still ? duration + fly + 1000 : t - t0;
    g.clearRect(0, 0, W, H);
    // Links fade in once both ends have arrived.
    g.lineWidth = 0.6;
    for (const [a, b] of links) {
      const A = stars[a], B = stars[b];
      const k = Math.min(1, Math.max(0, (e - Math.max(A.delay, B.delay) - fly) / 500));
      if (k <= 0) continue;
      g.strokeStyle = `rgba(${cr},${cg},${cb},${0.22 * k})`;
      g.beginPath();
      g.moveTo(A.x, A.y);
      g.lineTo(B.x, B.y);
      g.stroke();
    }
    for (const s of stars) {
      const k = Math.min(1, Math.max(0, (e - s.delay) / fly));
      if (k <= 0) continue;
      const q = 1 - Math.pow(1 - k, 3);
      const x = s.sx + (s.x - s.sx) * q;
      const y = s.sy + (s.y - s.sy) * q;
      const twinkle = k >= 1 ? 0.75 + 0.25 * Math.sin(e / 380 + s.tw) : 1;
      const a = Math.min(1, k * 1.4) * twinkle;
      // A short trail while it travels.
      if (k < 1 && !still) {
        const px = s.sx + (s.x - s.sx) * Math.max(0, q - 0.08);
        const py = s.sy + (s.y - s.sy) * Math.max(0, q - 0.08);
        g.strokeStyle = `rgba(${cr},${cg},${cb},${0.35 * a})`;
        g.lineWidth = s.r;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(x, y);
        g.stroke();
      }
      g.fillStyle = `rgba(${cr},${cg},${cb},${0.18 * a})`;
      g.beginPath();
      g.arc(x, y, s.r * 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.arc(x, y, s.r, 0, Math.PI * 2);
      g.fill();
    }
    if (e >= duration + fly) resolveDone();
    if (!still && !stopped) raf = requestAnimationFrame(frame);
  }
  if (still) frame(0);
  else raf = requestAnimationFrame(frame);
  return {
    done,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      resolveDone();
    },
    count: stars.length,
  };
}
