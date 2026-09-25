// Ambient background effects rendered on the #fx-canvas layer.
//   aurora → the CSS aurora div (no canvas)
//   tech   → a quiet plexus network with data pulses, drifting glyphs, and
//            a scanline sweep — all theme-colored, matte-appropriate
// Deterministic, no network, pauses when the tab is hidden, respects
// prefers-reduced-motion, and caps devicePixelRatio for performance.

let canvas = null;
let ctx = null;
let raf = 0;
let mode = "none";
let W = 0;
let H = 0;
let frame = 0;
let accent = "#6f4e37";
let accentRgb = [111, 78, 55];

// Scene state
let nodes = [];
let pulses = [];
let glyphs = [];
const mouse = { x: -1e4, y: -1e4 };

function reducedMotion() {
  return (
    document.documentElement.getAttribute("data-motion") === "reduce" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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
  if (mode === "tech") drawTech();
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

// Switch the ambient effect. "aurora" uses the CSS layer, "image" paints an
// uploaded photo behind the app, and the rest render on the canvas.
export function applyEffect(id, imageUrl = null) {
  ensureCanvas();
  mode = id;
  document.body.classList.toggle("no-aurora", id !== "aurora");

  // Uploaded ambient photo sits behind everything (dimmed for readability).
  if (id === "image" && imageUrl) {
    document.body.style.backgroundImage = `linear-gradient(rgba(17,15,12,0.62), rgba(17,15,12,0.72)), url(${imageUrl})`;
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundAttachment = "fixed";
  } else {
    document.body.style.removeProperty("background-image");
    document.body.style.removeProperty("background-size");
    document.body.style.removeProperty("background-position");
    document.body.style.removeProperty("background-attachment");
  }

  const canvasMode = id === "tech";
  canvas.style.display = canvasMode ? "block" : "none";

  stopLoop();
  if (!canvasMode) return;

  resize();
  if (reducedMotion()) {
    // Render one static frame instead of animating.
    frame++;
    refreshAccent();
    drawTech();
    return;
  }
  startLoop();
}
