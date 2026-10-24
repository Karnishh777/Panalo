// Coded art (v0.2): Pan the mascot, the eight subject emblems and the
// ember layer, drawn live on <canvas>. They stand in for the painted
// bitmaps (art.js) until those exist, and need no files at all.
//
// One animation loop drives every piece; a piece only animates while it
// is on screen, the tab is visible, and motion isn't reduced (then it
// draws a single still frame). Pure canvas 2D: no libraries.
import { reducedMotion } from "./motion.js";

const TAU = Math.PI * 2;
const pieces = new Set();
let raf = 0;
let last = 0;

function loop(now) {
  raf = 0;
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;
  let any = false;
  for (const p of pieces) {
    if (!p.canvas.isConnected) {
      pieces.delete(p);
      continue;
    }
    if (p.visible && p.animate && !document.hidden) {
      p.t += dt;
      p.draw(dt);
      any = true;
    }
  }
  if (any) raf = requestAnimationFrame(loop);
}
function kick() {
  if (!raf && !reducedMotion()) {
    last = 0;
    raf = requestAnimationFrame(loop);
  }
}
document.addEventListener("visibilitychange", kick);

const io = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = [...pieces].find((x) => x.canvas === e.target);
        if (p) p.visible = e.isIntersecting;
      }
      kick();
    })
  : null;

/** Size a canvas for the screen's pixel density; returns its 2D context. */
function setup(canvas, w, h) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function register(p) {
  p.t = Math.random() * 10;
  p.visible = !io;
  pieces.add(p);
  io?.observe(p.canvas);
  p.draw(0); // a first frame at once, and the only one with motion reduced
  kick();
  return p;
}

function unregister(p) {
  pieces.delete(p);
  io?.unobserve(p.canvas);
}

const rand = (a, b) => a + Math.random() * (b - a);

// ---- Pan -------------------------------------------------------------------------------

/**
 * Pan, the mascot: a young star of molten light with a flame crown.
 * Poses: "idle" (floats, waves), "cheer" (sparks burst), "think" (looks
 * up), "sleep" (eyes closed, dimmed). Returns { canvas, setPose, destroy }.
 */
export function createPan({ size = 120, pose = "idle", label = "" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "pan pan-live";
  canvas.style.width = canvas.style.height = `${size}px`;
  if (label) {
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", label);
  } else canvas.setAttribute("aria-hidden", "true");
  const S = size;
  const ctx = setup(canvas, S, S);
  const flames = [];
  const sparks = [];
  let blink = 0;
  let nextBlink = rand(1.5, 4);

  // The lava core: dark blotches, drawn once, turned slowly.
  const core = document.createElement("canvas");
  core.width = core.height = 128;
  const cc = core.getContext("2d");
  for (let i = 0; i < 26; i++) {
    const x = rand(10, 118);
    const y = rand(10, 118);
    const r = rand(6, 20);
    const g = cc.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(70,24,8,0.55)");
    g.addColorStop(1, "rgba(70,24,8,0)");
    cc.fillStyle = g;
    cc.beginPath();
    cc.arc(x, y, r, 0, TAU);
    cc.fill();
  }

  const p = {
    canvas,
    animate: true,
    pose,
    draw(dt) {
      const t = this.t;
      const sleep = this.pose === "sleep";
      const cheer = this.pose === "cheer";
      const think = this.pose === "think";
      const bob = Math.sin(t * (sleep ? 0.9 : 1.6)) * S * (sleep ? 0.01 : 0.022) - (cheer ? Math.abs(Math.sin(t * 6)) * S * 0.03 : 0);
      const cx = S / 2;
      const cy = S * 0.58 + bob;
      const r = S * 0.25;
      ctx.clearRect(0, 0, S, S);

      // Flame crown: particles rising from the top, added light.
      const rate = sleep ? 0.25 : cheer ? 2.4 : 1;
      for (let i = 0; i < Math.ceil(rate * 2); i++) {
        if (flames.length < 70 && Math.random() < rate * 0.9) {
          const a = -Math.PI / 2 + rand(-0.55, 0.55);
          flames.push({ x: cx + Math.cos(a) * r * 0.85, y: cy + Math.sin(a) * r * 0.85, vx: rand(-6, 6), vy: -rand(18, 34) * (sleep ? 0.5 : 1) * (cheer ? 1.5 : 1), life: 1, s: rand(0.05, 0.09) * S });
        }
      }
      ctx.globalCompositeOperation = "lighter";
      for (let i = flames.length - 1; i >= 0; i--) {
        const f = flames[i];
        f.life -= dt * (sleep ? 0.9 : 1.6);
        if (f.life <= 0) {
          flames.splice(i, 1);
          continue;
        }
        f.x += (f.vx + Math.sin(t * 4 + i) * 6) * dt;
        f.y += f.vy * dt;
        const s = f.s * f.life;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, s);
        g.addColorStop(0, `rgba(255,236,170,${0.9 * f.life})`);
        g.addColorStop(0.4, `rgba(255,150,40,${0.55 * f.life})`);
        g.addColorStop(1, "rgba(255,60,10,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, s, 0, TAU);
        ctx.fill();
      }

      // Outer glow.
      const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.9);
      glow.addColorStop(0, `rgba(255,140,40,${sleep ? 0.18 : 0.32})`);
      glow.addColorStop(1, "rgba(255,90,20,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.9, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      // Arms (behind the body).
      ctx.lineCap = "round";
      ctx.strokeStyle = "#ffae42";
      ctx.lineWidth = S * 0.055;
      const arm = (side, angle) => {
        const sx = cx + side * r * 0.88;
        const sy = cy + r * 0.1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(angle) * r * 0.42 * side, sy + Math.sin(angle) * r * 0.42);
        ctx.stroke();
      };
      if (cheer) {
        arm(-1, -1.1 + Math.sin(t * 10) * 0.15);
        arm(1, -1.1 + Math.sin(t * 10 + 1) * 0.15);
      } else if (think) {
        arm(-1, 0.5);
        ctx.beginPath(); // a hand at the chin
        ctx.moveTo(cx + r * 0.85, cy + r * 0.15);
        ctx.quadraticCurveTo(cx + r * 0.95, cy + r * 0.6, cx + r * 0.42, cy + r * 0.5);
        ctx.stroke();
      } else if (sleep) {
        arm(-1, 0.9);
        arm(1, 0.9);
      } else {
        arm(-1, 0.6);
        arm(1, -0.9 + Math.sin(t * 5) * 0.45); // the wave
      }

      // Body: molten light, the core turning inside.
      const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
      body.addColorStop(0, sleep ? "#ffe0a3" : "#fff4c8");
      body.addColorStop(0.35, sleep ? "#f5a54a" : "#ffbe55");
      body.addColorStop(0.8, sleep ? "#d0661f" : "#ff7d1f");
      body.addColorStop(1, sleep ? "#8f3a10" : "#c2410c");
      ctx.save();
      ctx.shadowColor = "rgba(255,120,30,0.8)";
      ctx.shadowBlur = sleep ? S * 0.06 : S * 0.12;
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.clip();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.15);
      ctx.globalAlpha = 0.8;
      ctx.drawImage(core, -r, -r, r * 2, r * 2);
      ctx.restore();

      // Face.
      blink -= dt;
      if (blink <= 0 && (nextBlink -= dt) <= 0) {
        blink = 0.14;
        nextBlink = rand(2.5, 5.5);
      }
      const ex = r * 0.36;
      const ey = cy - r * 0.08;
      const look = think ? { x: r * 0.06, y: -r * 0.08 } : { x: Math.sin(t * 0.5) * r * 0.03, y: 0 };
      ctx.fillStyle = "#1a0f0a";
      ctx.strokeStyle = "#1a0f0a";
      for (const side of [-1, 1]) {
        const x = cx + side * ex + look.x;
        if (sleep) {
          ctx.lineWidth = S * 0.022;
          ctx.beginPath();
          ctx.arc(x, ey, r * 0.12, 0.15 * Math.PI, 0.85 * Math.PI);
          ctx.stroke();
          continue;
        }
        const open = blink > 0 ? 0.12 : 1;
        ctx.beginPath();
        ctx.ellipse(x, ey + look.y, r * 0.13, r * 0.18 * open, 0, 0, TAU);
        ctx.fill();
        if (open > 0.5) {
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(x - r * 0.04 + look.x * 0.5, ey + look.y - r * 0.07, r * 0.045, 0, TAU);
          ctx.fill();
          ctx.fillStyle = "#1a0f0a";
        }
      }
      ctx.lineWidth = S * 0.02;
      ctx.beginPath();
      if (cheer) {
        ctx.arc(cx, cy + r * 0.24, r * 0.17, 0.05 * Math.PI, 0.95 * Math.PI);
        ctx.fill();
      } else if (!sleep) {
        ctx.arc(cx + (think ? r * 0.08 : 0), cy + r * 0.2, r * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }

      // Scarf: deep blue with a fluttering tail and tiny stars.
      ctx.strokeStyle = "#1e3a8a";
      ctx.lineWidth = S * 0.07;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.05, r * 0.98, 0.22 * Math.PI, 0.78 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = "#1e3a8a";
      const tx = cx + r * 0.55;
      const ty = cy + r * 0.8;
      const flap = Math.sin(t * 4) * r * 0.12;
      ctx.beginPath();
      ctx.moveTo(tx - r * 0.1, ty - r * 0.05);
      ctx.quadraticCurveTo(tx + r * 0.3, ty + r * 0.2 + flap, tx + r * 0.45, ty + r * 0.45 + flap);
      ctx.lineTo(tx + r * 0.25, ty + r * 0.5 + flap);
      ctx.quadraticCurveTo(tx + r * 0.1, ty + r * 0.25, tx - r * 0.18, ty + r * 0.08);
      ctx.fill();
      ctx.fillStyle = "rgba(190,215,255,0.85)";
      for (let i = 0; i < 5; i++) {
        const a = (0.3 + i * 0.1) * Math.PI;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 0.98, cy - r * 0.05 + Math.sin(a) * r * 0.98, S * 0.006, 0, TAU);
        ctx.fill();
      }

      // Cheer: a ring of sparks; sleep: one ember drifting up.
      ctx.globalCompositeOperation = "lighter";
      if (cheer && sparks.length < 40 && Math.random() < 0.5) {
        const a = rand(0, TAU);
        sparks.push({ x: cx, y: cy, vx: Math.cos(a) * rand(40, 90), vy: Math.sin(a) * rand(40, 90), life: 1 });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt * 1.4;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        ctx.fillStyle = `rgba(255,${180 + ((i * 7) % 60)},90,${s.life})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, S * 0.012 * s.life + 0.6, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };
  register(p);
  return {
    canvas,
    setPose(next) {
      p.pose = next;
      if (next === "cheer") {
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * TAU;
          sparks.push({ x: S / 2, y: S * 0.58, vx: Math.cos(a) * rand(60, 110), vy: Math.sin(a) * rand(60, 110), life: 1 });
        }
      }
      p.draw(0);
      kick();
    },
    destroy: () => unregister(p),
  };
}

// ---- Subject emblems -------------------------------------------------------------------

// Each emblem draws itself in its colour at time t on a w×h canvas.
// Inactive emblems hold still (one frame); the chosen one moves.
const EMBLEMS = {
  physics(c, t, w, h, col) {
    const px = w / 2;
    const py = h * 0.18;
    const len = h * 0.5;
    const a = Math.sin(t * 2) * 0.6;
    const bx = px + Math.sin(a) * len;
    const by = py + Math.cos(a) * len;
    line(c, px - w * 0.18, py, px + w * 0.18, py, col, 3);
    line(c, px, py, bx, by, col, 2);
    disc(c, bx, by, w * 0.08, col);
    // Lightning arcs around the bob, redrawn every few frames.
    const seed = Math.floor(t * 9);
    for (let k = 0; k < 3; k++) {
      let x = bx;
      let y = by;
      const ang = ((seed * 37 + k * 120) % 360) * (Math.PI / 180);
      c.beginPath();
      c.moveTo(x, y);
      for (let i = 0; i < 5; i++) {
        x += Math.cos(ang) * w * 0.05 + (((seed * (i + 3) * 13) % 11) - 5) * 1.6;
        y += Math.sin(ang) * w * 0.05 + (((seed * (i + 5) * 7) % 11) - 5) * 1.6;
        c.lineTo(x, y);
      }
      glowStroke(c, "#e8f6ff", 1.4);
    }
  },
  chemistry(c, t, w, h, col) {
    const cx = w / 2;
    const cy = h * 0.62;
    const r = w * 0.24;
    c.beginPath();
    c.moveTo(cx - w * 0.07, h * 0.18);
    c.lineTo(cx - w * 0.07, cy - r * 0.85);
    c.arc(cx, cy, r, -Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3 + TAU - 0.0001, false);
    c.lineTo(cx + w * 0.07, h * 0.18);
    glowStroke(c, col, 2.5);
    // A swirling flame inside.
    c.save();
    c.beginPath();
    c.arc(cx, cy, r - 3, 0, TAU);
    c.clip();
    for (let i = 0; i < 18; i++) {
      const a = t * 2.2 + i * 0.35;
      const rr = (r * 0.75 * (i + 1)) / 18;
      disc(c, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.6, 3 + (18 - i) * 0.25, i % 2 ? "#ff7a1a" : col, 0.55);
    }
    c.restore();
    for (let i = 0; i < 4; i++) {
      const y = h * 0.42 - ((t * 30 + i * 20) % (h * 0.3));
      disc(c, cx + Math.sin(t * 3 + i) * 4, y, 2.5, col, 0.7);
    }
  },
  biology(c, t, w, h, col) {
    const grow = (t * 0.35) % 1.4;
    const n = 40;
    c.beginPath();
    let lx = 0;
    let ly = 0;
    for (let i = 0; i <= n * Math.min(1, grow); i++) {
      const u = i / n;
      lx = w / 2 + Math.sin(u * 7) * w * 0.16;
      ly = h * 0.9 - u * h * 0.75;
      if (i === 0) c.moveTo(lx, ly);
      else c.lineTo(lx, ly);
      if (i % 8 === 4) leaf(c, lx, ly, (i % 16 === 4 ? 1 : -1) * w * 0.1, col);
    }
    glowStroke(c, col, 2.5);
    disc(c, lx, ly, 4 + Math.sin(t * 6) * 1.5, "#eafff2");
  },
  maths(c, t, w, h, col) {
    const cx = w / 2;
    const cy = h / 2;
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.ellipse(cx, cy, w * (0.36 - k * 0.08), w * 0.12, t * (0.6 + k * 0.3) + k, 0, TAU);
      glowStroke(c, col, 1.6);
    }
    // A golden spiral, drawn and redrawn.
    const turns = ((t * 0.5) % 1) * 3.2 + 0.6;
    c.beginPath();
    for (let a = 0; a < turns * Math.PI; a += 0.08) {
      const rr = 2 * Math.pow(1.17, a * 2);
      const x = cx + Math.cos(a + t) * rr;
      const y = cy + Math.sin(a + t) * rr;
      if (a === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    glowStroke(c, "#ffd27a", 1.8);
  },
  computing(c, t, w, h, col) {
    const cols = 7;
    for (let i = 0; i < cols; i++) {
      const x = w * 0.18 + (i * w * 0.64) / (cols - 1);
      const speed = 40 + ((i * 17) % 30);
      for (let j = 0; j < 5; j++) {
        const y = ((t * speed + j * 34 + i * 19) % (h * 0.9)) + h * 0.05;
        const a = 1 - j * 0.18;
        line(c, x, y, x, y + 10, col, 2, a);
      }
    }
    // A pulse line across.
    c.beginPath();
    for (let x = 0; x <= w; x += 3) {
      const u = x / w;
      const spike = Math.exp(-Math.pow((u - ((t * 0.4) % 1)) * 14, 2));
      const y = h / 2 - spike * h * 0.18 * Math.sin(u * 60);
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    glowStroke(c, "#ffe3ec", 1.4);
  },
  commerce(c, t, w, h, col) {
    const cx = w / 2;
    const cy = h * 0.32;
    const r = w * 0.2;
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    glowStroke(c, col, 2);
    const a = Math.sin(t * 1.3) * 0.5 - 0.3;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
    c.lineTo(cx + Math.cos(a + 2.8) * r * 0.25, cy + Math.sin(a + 2.8) * r * 0.25);
    c.lineTo(cx + Math.cos(a - 2.8) * r * 0.25, cy + Math.sin(a - 2.8) * r * 0.25);
    c.closePath();
    c.fillStyle = "#ff7a5a";
    c.fill();
    const bars = 5;
    for (let i = 0; i < bars; i++) {
      const bh = h * (0.08 + 0.05 * i) * (0.7 + 0.3 * Math.sin(t * 2 + i));
      const x = w * 0.2 + i * w * 0.13;
      c.fillStyle = col;
      c.globalAlpha = 0.85;
      c.fillRect(x, h * 0.9 - bh, w * 0.08, bh);
      c.globalAlpha = 1;
    }
  },
  words(c, t, w, h, col) {
    // An ink trail from a moving quill (a slow figure-of-eight).
    const pts = 70;
    c.beginPath();
    for (let i = 0; i < pts; i++) {
      const u = t * 0.9 - i * 0.035;
      const x = w / 2 + Math.sin(u * 1.3) * w * 0.3;
      const y = h / 2 + Math.sin(u * 2.6) * h * 0.22;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    glowStroke(c, col, 2.2);
    const u = t * 0.9;
    const qx = w / 2 + Math.sin(u * 1.3) * w * 0.3;
    const qy = h / 2 + Math.sin(u * 2.6) * h * 0.22;
    c.save();
    c.translate(qx, qy);
    c.rotate(-0.7);
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(w * 0.06, -h * 0.12, w * 0.02, -h * 0.24);
    c.quadraticCurveTo(-w * 0.03, -h * 0.12, 0, 0);
    c.fillStyle = "#eafffe";
    c.globalAlpha = 0.85;
    c.fill();
    c.restore();
  },
  art(c, t, w, h, col) {
    const sweep = (t * 0.5) % 1.3;
    const n = 50;
    for (let i = 0; i < n * Math.min(1, sweep); i++) {
      const u = i / n;
      const x = w * 0.12 + u * w * 0.76;
      const y = h * 0.6 + Math.sin(u * 5 + 1) * h * 0.14;
      disc(c, x, y, w * 0.05 * (1 - Math.abs(u - 0.5)) + 2, i % 3 ? col : "#ff6a3d", 0.5);
    }
    const u = Math.min(1, sweep);
    const tx = w * 0.12 + u * w * 0.76;
    const ty = h * 0.6 + Math.sin(u * 5 + 1) * h * 0.14;
    for (let i = 0; i < 6; i++) disc(c, tx + Math.sin(t * 9 + i) * 10, ty + Math.cos(t * 7 + i) * 10, 1.8, "#ffd9b0");
  },
};

function line(c, x1, y1, x2, y2, col, wdt, a = 1) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.globalAlpha = a;
  glowStroke(c, col, wdt);
  c.globalAlpha = 1;
}
function disc(c, x, y, r, col, a = 1) {
  c.globalAlpha = a;
  c.fillStyle = col;
  c.shadowColor = col;
  c.shadowBlur = r * 2;
  c.beginPath();
  c.arc(x, y, Math.max(0.5, r), 0, TAU);
  c.fill();
  c.shadowBlur = 0;
  c.globalAlpha = 1;
}
function glowStroke(c, col, wdt) {
  c.strokeStyle = col;
  c.lineWidth = wdt;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.shadowColor = col;
  c.shadowBlur = 10;
  c.stroke();
  c.shadowBlur = 0;
}
function leaf(c, x, y, len, col) {
  c.save();
  c.translate(x, y);
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(len * 0.5, -Math.abs(len) * 0.5, len, 0);
  c.quadraticCurveTo(len * 0.5, Math.abs(len) * 0.35, 0, 0);
  c.fillStyle = col;
  c.globalAlpha = 0.75;
  c.fill();
  c.restore();
  c.globalAlpha = 1;
}

/**
 * A subject family's emblem ("physics", "maths", ...) in its colour.
 * Returns { canvas, setActive(on), destroy }: only the active one moves.
 */
export function createEmblem(family, colour, { width = 150, height = 200, at = 2.5 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "emblem";
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.setAttribute("aria-hidden", "true");
  const ctx = setup(canvas, width, height);
  const drawFn = EMBLEMS[family] || EMBLEMS.words;
  const p = {
    canvas,
    animate: false,
    draw() {
      ctx.clearRect(0, 0, width, height);
      drawFn(ctx, this.t, width, height, colour);
    },
  };
  register(p);
  p.t = at; // a still frame from a moment where every emblem reads well
  p.draw(0);
  return {
    canvas,
    setActive(on) {
      p.animate = !!on;
      p.draw(0);
      kick();
    },
    destroy: () => unregister(p),
  };
}

// ---- Embers ----------------------------------------------------------------------------

/**
 * A layer of embers rising slowly over the dark. `animate` false draws one
 * still frame (calm effects, reduced motion). Returns { canvas, setAnimate, destroy }.
 */
export function createEmbers({ animate = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "embers";
  canvas.setAttribute("aria-hidden", "true");
  let w = window.innerWidth;
  let h = window.innerHeight;
  let ctx = setup(canvas, w, h);
  const motes = Array.from({ length: Math.round(Math.min(90, (w * h) / 16000)) }, () => ({
    x: Math.random(),
    y: Math.random(),
    s: rand(0.6, 2.4),
    v: rand(0.006, 0.02),
    ph: rand(0, TAU),
  }));
  const onResize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    ctx = setup(canvas, w, h);
    p.draw(0);
  };
  window.addEventListener("resize", onResize);
  const p = {
    canvas,
    animate,
    draw(dt) {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const m of motes) {
        m.y -= m.v * dt;
        if (m.y < -0.05) {
          m.y = 1.05;
          m.x = Math.random();
        }
        const x = (m.x + Math.sin(this.t * 0.3 + m.ph) * 0.01) * w;
        const y = m.y * h;
        // Brighter low down, fading as they rise.
        const a = 0.15 + 0.55 * m.y;
        const g = ctx.createRadialGradient(x, y, 0, x, y, m.s * 4);
        g.addColorStop(0, `rgba(255,200,120,${a})`);
        g.addColorStop(0.4, `rgba(255,120,40,${a * 0.5})`);
        g.addColorStop(1, "rgba(255,80,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, m.s * 4, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };
  register(p);
  return {
    canvas,
    setAnimate(on) {
      p.animate = !!on;
      kick();
    },
    destroy() {
      window.removeEventListener("resize", onResize);
      unregister(p);
    },
  };
}
