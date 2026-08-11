// Ambient background effects rendered on the #fx-canvas layer.
//   aurora  → the CSS aurora div (no canvas)
//   liquid  → slow-drifting blurred color blobs ("liquid retina" glass feel)
//   bubbles → translucent bubbles rising with a light wobble
//   tech    → the flagship: a glowing plexus network with data pulses,
//             drifting glyphs, and a scanline sweep — all theme-colored
// Deterministic, no network, pauses when the tab is hidden, respects
// prefers-reduced-motion, and caps devicePixelRatio for performance.

let canvas = null;
let ctx = null;
let raf = 0;
let mode = "none";
let W = 0;
let H = 0;
let frame = 0;
let accent = "#8b7cf6";
let accentRgb = [139, 124, 246];

// Scene state
let blobs = [];
let bubbles = [];
let nodes = [];
let pulses = [];
let glyphs = [];
const mouse = { x: -1e4, y: -1e4 };

const LIQUID_PALETTE = [
  [139, 124, 246], // violet
  [255, 110, 174], // pink
  [55, 194, 224],  // cyan
  [255, 138, 91],  // orange
  [108, 92, 231],  // deep violet
];

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hexToRgb(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [139, 124, 246];
}

function refreshAccent() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  if (v && v.startsWith("#")) {
    accent = v;
    accentRgb = hexToRgb(v);
  }
}

function ensureCanvas() {
  if (canvas) return;
  canvas = document.getElementById("fx-canvas");
  ctx = canvas.getContext("2d");
  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLoop();
    else if (mode !== "none" && mode !== "aurora") startLoop();
  });
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  seed();
}

const rand = (a, b) => a + Math.random() * (b - a);

function seed() {
  // Liquid blobs
  blobs = [];
  for (let i = 0; i < 6; i++) {
    blobs.push({
      cx: rand(0.1, 0.9), cy: rand(0.1, 0.9),
      r: rand(Math.min(W, H) * 0.18, Math.min(W, H) * 0.34),
      ax: rand(0.06, 0.16), ay: rand(0.06, 0.16),
      sx: rand(0.00016, 0.00034), sy: rand(0.00013, 0.0003),
      p1: rand(0, Math.PI * 2), p2: rand(0, Math.PI * 2),
      color: i === 0 ? null : LIQUID_PALETTE[i % LIQUID_PALETTE.length], // null → accent
    });
  }
  // Bubbles
  bubbles = [];
  const nb = Math.min(30, Math.round(W / 46));
  for (let i = 0; i < nb; i++) {
    bubbles.push({
      x: rand(0, W), y: rand(0, H),
      r: rand(5, 34), v: rand(0.18, 0.8),
      w: rand(0.4, 1.6), p: rand(0, Math.PI * 2), a: rand(0.08, 0.2),
    });
  }
  // Tech nodes
  nodes = [];
  const nn = Math.min(95, Math.round((W * H) / 16000));
  for (let i = 0; i < nn; i++) {
    nodes.push({
      x: rand(0, W), y: rand(0, H),
      vx: rand(-0.28, 0.28), vy: rand(-0.28, 0.28),
      r: rand(1.2, 2.4),
    });
  }
  pulses = [];
  // Tech glyphs (drifting hex/binary characters)
  glyphs = [];
  const chars = "01</>#{}$ΣΔλΨ0110";
  for (let i = 0; i < 26; i++) {
    glyphs.push({
      x: rand(0, W), y: rand(0, H),
      c: chars[Math.floor(rand(0, chars.length))],
      v: rand(0.12, 0.45), s: rand(9, 15), a: rand(0.05, 0.14),
    });
  }
}

// ---- Renderers ----
function drawLiquid() {
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  const t = frame;
  for (const b of blobs) {
    const x = (b.cx + Math.sin(t * b.sx * 60 + b.p1) * b.ax) * W;
    const y = (b.cy + Math.cos(t * b.sy * 60 + b.p2) * b.ay) * H;
    const [r, g, bl] = b.color || accentRgb;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, b.r);
    grad.addColorStop(0, `rgba(${r},${g},${bl},0.34)`);
    grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawBubbles() {
  ctx.clearRect(0, 0, W, H);
  const [r, g, b] = accentRgb;
  for (const bu of bubbles) {
    bu.y -= bu.v;
    bu.p += 0.01 * bu.w;
    const x = bu.x + Math.sin(bu.p) * 14;
    if (bu.y < -bu.r) {
      bu.y = H + bu.r;
      bu.x = rand(0, W);
    }
    // body
    ctx.beginPath();
    ctx.arc(x, bu.y, bu.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${bu.a * 0.35})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${bu.a})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // shine
    ctx.beginPath();
    ctx.arc(x - bu.r * 0.32, bu.y - bu.r * 0.34, bu.r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${bu.a * 0.9})`;
    ctx.fill();
  }
}

const LINK_DIST = 132;

function drawTech() {
  ctx.clearRect(0, 0, W, H);
  const [r, g, b] = accentRgb;

  // Faint grid
  ctx.strokeStyle = `rgba(${r},${g},${b},0.045)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < W; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y < H; y += 48) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  // Drifting glyphs
  ctx.textBaseline = "middle";
  for (const gl of glyphs) {
    gl.y -= gl.v;
    if (gl.y < -20) { gl.y = H + 20; gl.x = rand(0, W); }
    ctx.font = `${gl.s}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = `rgba(${r},${g},${b},${gl.a})`;
    ctx.fillText(gl.c, gl.x, gl.y);
  }

  // Move nodes (slight pull toward the cursor)
  for (const n of nodes) {
    const dx = mouse.x - n.x;
    const dy = mouse.y - n.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 160 * 160 && d2 > 1) {
      n.vx += (dx / Math.sqrt(d2)) * 0.006;
      n.vy += (dy / Math.sqrt(d2)) * 0.006;
    }
    n.vx = Math.max(-0.5, Math.min(0.5, n.vx));
    n.vy = Math.max(-0.5, Math.min(0.5, n.vy));
    n.x += n.vx;
    n.y += n.vy;
    if (n.x < 0) n.x = W; else if (n.x > W) n.x = 0;
    if (n.y < 0) n.y = H; else if (n.y > H) n.y = 0;
  }

  // Links between close nodes
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const c = nodes[j];
      const dx = a.x - c.x;
      const dy = a.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d < LINK_DIST) {
        ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - d / LINK_DIST) * 0.32})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
    }
    // Brighter link to the cursor
    const md = Math.hypot(a.x - mouse.x, a.y - mouse.y);
    if (md < 170) {
      ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - md / 170) * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(mouse.x, mouse.y);
      ctx.stroke();
    }
    // Node dot
    ctx.fillStyle = `rgba(${r},${g},${b},0.75)`;
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Data pulses traveling along random links
  if (frame % 34 === 0 && nodes.length > 1 && pulses.length < 7) {
    for (let tries = 0; tries < 8; tries++) {
      const a = nodes[Math.floor(rand(0, nodes.length))];
      const c = nodes[Math.floor(rand(0, nodes.length))];
      if (a !== c && Math.hypot(a.x - c.x, a.y - c.y) < LINK_DIST) {
        pulses.push({ a, b: c, t: 0 });
        break;
      }
    }
  }
  ctx.save();
  ctx.shadowBlur = 12;
  ctx.shadowColor = accent;
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    p.t += 0.035;
    if (p.t >= 1) {
      pulses.splice(i, 1);
      continue;
    }
    const x = p.a.x + (p.b.x - p.a.x) * p.t;
    const y = p.a.y + (p.b.y - p.a.y) * p.t;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Scanline sweep (every ~7s)
  const sw = (frame % 420) / 420;
  const sy = sw * (H + 160) - 80;
  const grad = ctx.createLinearGradient(0, sy - 60, 0, sy + 60);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(0.5, `rgba(${r},${g},${b},0.05)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, sy - 60, W, 120);
}

// ---- Loop control ----
function tick() {
  frame++;
  if (frame % 120 === 0) refreshAccent();
  if (mode === "liquid") drawLiquid();
  else if (mode === "bubbles") drawBubbles();
  else if (mode === "tech") drawTech();
  raf = requestAnimationFrame(tick);
}

function startLoop() {
  if (raf) return;
  refreshAccent();
  raf = requestAnimationFrame(tick);
}

function stopLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

// Switch the ambient effect. "aurora" uses the CSS layer; canvas modes render here.
export function applyEffect(id) {
  ensureCanvas();
  mode = id;
  document.body.classList.toggle("no-aurora", id !== "aurora");

  const canvasMode = id === "liquid" || id === "bubbles" || id === "tech";
  canvas.style.display = canvasMode ? "block" : "none";
  canvas.style.filter = id === "liquid" ? "blur(60px) saturate(1.25)" : "none";

  stopLoop();
  if (!canvasMode) return;

  resize();
  if (reducedMotion()) {
    // Render one static frame instead of animating.
    frame++;
    refreshAccent();
    if (id === "liquid") drawLiquid();
    else if (id === "bubbles") drawBubbles();
    else drawTech();
    return;
  }
  startLoop();
}
