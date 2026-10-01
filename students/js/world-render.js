// Draws a world from the layers in model/world-model.js.
//
// Cost model, because this runs on school laptops and old phones:
//   - The planet's surface is generated ONCE per seed into a 256x128
//     texture (3D value noise sampled on the sphere, so there is no seam),
//     while the browser is idle, and cached for the rest of the session.
//   - Changing a layer (more land, more lights) recolours that texture;
//     nothing is regenerated.
//   - The projection from screen pixel to latitude/longitude is computed
//     ONCE per size. A frame is then a texture lookup per pixel of a disk
//     at most 300px across, plus a few canvas strokes.
//   - Frames are capped at ~30 per second, stop while hidden or off screen,
//     and with reduced motion the world is drawn once and left still.
import { reducedMotion, animationLoop } from "./motion.js";

const TW = 256;
const TH = 128;
const TAU = Math.PI * 2;

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 3D value noise over a hashed lattice.
function makeNoise(seed) {
  const rnd = mulberry(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const lat = (x, y, z) => vals[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  const fade = (t) => t * t * (3 - 2 * t);
  const noise = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(lat(xi, yi, zi), lat(xi + 1, yi, zi), xf), l(lat(xi, yi + 1, zi), lat(xi + 1, yi + 1, zi), xf), yf),
      l(l(lat(xi, yi, zi + 1), lat(xi + 1, yi, zi + 1), xf), l(lat(xi, yi + 1, zi + 1), lat(xi + 1, yi + 1, zi + 1), xf), yf),
      zf
    );
  };
  return (x, y, z, octaves = 5) => {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * f + 11.3, y * f + 7.1, z * f + 3.7);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  };
}

// Everything that depends only on the seed -- cached, so moving from Now to
// World doesn't generate the same planet twice.
const surfaces = new Map();
function surfaceFor(seedText) {
  const key = String(seedText || "panalo");
  if (!surfaces.has(key)) {
    if (surfaces.size > 4) surfaces.delete(surfaces.keys().next().value);
    surfaces.set(key, makeSurface(key));
  }
  return surfaces.get(key);
}

function makeSurface(seedText) {
  const seed = hashString(String(seedText || "panalo"));
  const fbm = makeNoise(seed);
  const fbm2 = makeNoise(seed ^ 0x9e3779b9);
  const height = new Float32Array(TW * TH);
  const moist = new Float32Array(TW * TH);
  const cloud = new Float32Array(TW * TH);
  const weight = new Float32Array(TW * TH);
  const key = new Float32Array(TW * TH);
  const rnd = mulberry(seed ^ 0x1234567);
  for (let j = 0; j < TH; j++) {
    const lat = ((j + 0.5) / TH) * Math.PI - Math.PI / 2;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < TW; i++) {
      const lon = ((i + 0.5) / TW) * TAU;
      const x = cl * Math.cos(lon), y = sl, z = cl * Math.sin(lon);
      const k = j * TW + i;
      height[k] = fbm(x * 1.6, y * 1.6, z * 1.6);
      moist[k] = fbm2(x * 2.2, y * 2.2, z * 2.2, 4);
      cloud[k] = fbm2(x * 3.1 + 40, y * 5.2, z * 3.1, 4);
      weight[k] = cl; // area of a texel shrinks toward the poles
      key[k] = rnd();
    }
  }
  // Area-weighted height quantiles, so "land = 20%" means 20% of the
  // surface rather than 20% of the texture.
  const order = Array.from(height.keys()).sort((a, b) => height[b] - height[a]);
  let total = 0;
  for (let k = 0; k < weight.length; k++) total += weight[k];
  const cum = new Float32Array(order.length);
  let acc = 0;
  for (let n = 0; n < order.length; n++) {
    acc += weight[order[n]];
    cum[n] = acc / total;
  }
  const moistOrder = Array.from(moist.keys()).sort((a, b) => moist[a] - moist[b]);
  const moistRank = new Float32Array(moist.length);
  moistRank.forEach((_, n) => (moistRank[moistOrder[n]] = n / moistOrder.length));
  return { height, moistRank, cloud, order, cum, key };
}

function thresholdFor(surface, fraction) {
  const { order, cum, height } = surface;
  let lo = 0, hi = order.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < fraction) lo = mid + 1;
    else hi = mid;
  }
  return height[order[lo]];
}

const mix = (a, b, t) => a + (b - a) * t;

// Colour the surface for a set of layers. Returns RGB and a light map.
function paint(surface, L) {
  const { height, moistRank, key } = surface;
  const sea = thresholdFor(surface, Math.max(0.01, Math.min(0.9, L.land)));
  const color = new Uint8ClampedArray(TW * TH * 3);
  const isLand = new Uint8Array(TW * TH);
  const coast = new Float32Array(TW * TH);
  for (let k = 0; k < height.length; k++) isLand[k] = height[k] >= sea ? 1 : 0;
  for (let j = 0; j < TH; j++) {
    for (let i = 0; i < TW; i++) {
      const k = j * TW + i;
      const h = height[k];
      const lat = Math.abs(((j + 0.5) / TH) * 2 - 1);
      let r, g, b;
      if (isLand[k]) {
        const up = Math.min(1, (h - sea) / 0.18);
        const green = moistRank[k] < L.forest;
        if (green) {
          r = mix(46, 92, up); g = mix(118, 140, up); b = mix(84, 96, up);
        } else {
          r = mix(150, 176, up); g = mix(128, 160, up); b = mix(96, 140, up);
        }
        if (up > 0.82) { r = mix(r, 236, (up - 0.82) * 5); g = mix(g, 240, (up - 0.82) * 5); b = mix(b, 246, (up - 0.82) * 5); }
      } else {
        const depth = Math.min(1, (sea - h) / 0.22);
        r = mix(30, 8, depth); g = mix(84, 26, depth); b = mix(140, 70, depth);
        // Reading lights the shallows: a cyan glow along the coasts.
        if (L.glow > 0) {
          const near = Math.max(0, 1 - depth * 3.2) * L.glow;
          r = mix(r, 70, near); g = mix(g, 230, near); b = mix(b, 220, near);
        }
      }
      if (lat > 0.86) { // ice caps
        const ice = Math.min(1, (lat - 0.86) * 9);
        r = mix(r, 232, ice); g = mix(g, 240, ice); b = mix(b, 250, ice);
      }
      color[k * 3] = r; color[k * 3 + 1] = g; color[k * 3 + 2] = b;
    }
  }
  // Coastline texels are where cities like to be.
  for (let j = 1; j < TH - 1; j++) {
    for (let i = 0; i < TW; i++) {
      const k = j * TW + i;
      if (!isLand[k]) continue;
      const n = isLand[k - TW] + isLand[k + TW] + isLand[j * TW + ((i + 1) % TW)] + isLand[j * TW + ((i + TW - 1) % TW)];
      coast[k] = n < 4 ? 1 : 0;
    }
  }
  // One light per finished task, on the land texels with the smallest
  // (coast-weighted) keys -- so lights stay where they are as more arrive.
  const lights = new Float32Array(TW * TH);
  if (L.lights > 0) {
    const cand = [];
    for (let k = 0; k < key.length; k++) if (isLand[k]) cand.push(k);
    cand.sort((a, b) => key[a] / (1 + coast[a] * 2) - key[b] / (1 + coast[b] * 2));
    const n = Math.min(L.lights, cand.length);
    for (let m = 0; m < n; m++) lights[cand[m]] = 0.65 + 0.35 * key[cand[m]];
  }
  return { color: upsample(color), lights };
}

// Bilinear 2x upsample of the painted colours, once per repaint, so coasts
// read as curves rather than stairs. Frames still do one lookup per pixel.
const UW = TW * 2;
const UH = TH * 2;
function upsample(src) {
  const out = new Uint8ClampedArray(UW * UH * 3);
  for (let y = 0; y < UH; y++) {
    const sy = Math.max(0, Math.min(TH - 1, (y + 0.5) / 2 - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(TH - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < UW; x++) {
      const sx = (x + 0.5) / 2 - 0.5;
      const x0 = ((Math.floor(sx) % TW) + TW) % TW;
      const x1 = (x0 + 1) % TW;
      const fx = sx - Math.floor(sx);
      const o = (y * UW + x) * 3;
      for (let c = 0; c < 3; c++) {
        const a = src[(y0 * TW + x0) * 3 + c] * (1 - fx) + src[(y0 * TW + x1) * 3 + c] * fx;
        const b = src[(y1 * TW + x0) * 3 + c] * (1 - fx) + src[(y1 * TW + x1) * 3 + c] * fx;
        out[o + c] = a * (1 - fy) + b * fy;
      }
    }
  }
  return out;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{seed: string, tilt?: number, interactive?: boolean, maxDisk?: number}} opts
 */
export function createGlobe(canvas, { seed, tilt = 0.38, interactive = false, maxDisk = 300, spin = 0.00006 } = {}) {
  const ctx = canvas.getContext("2d");
  // Generating a planet takes a moment on a slow device, so it happens when
  // the browser is idle; until then only the atmosphere is drawn.
  let surface = surfaces.get(String(seed || "panalo")) || null;
  let layers = { land: 0.2, lights: 0, aurora: 0, forest: 0.4, glow: 0, atmosphere: 0.4, clouds: 0.1, ring: 0 };
  let moons = [];
  let painted = surface ? paint(surface, layers) : null;
  let destroyed = false;
  let rot = 0;
  let cloudShift = 0;
  let D = 0;
  let table = null;
  let disk = null;
  let diskCtx = null;
  let img = null;
  let frameSkip = false;
  let dragging = null;
  const still = () => reducedMotion();

  // Light comes from the upper left, so the right of the world is night
  // and the lights of finished tasks show there.
  const Lx = -0.62, Ly = -0.42, Lz = 0.66;

  function build() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = Math.max(40, Math.round(rect.width || canvas.width));
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round((rect.height || css) * dpr);
    D = Math.min(maxDisk, Math.round(canvas.width * 0.6));
    disk = document.createElement("canvas");
    disk.width = disk.height = D;
    diskCtx = disk.getContext("2d");
    img = diskCtx.createImageData(D, D);
    const R = D / 2;
    const n = D * D;
    table = { idx: new Int32Array(n).fill(-1), lat: new Float32Array(n), lon: new Float32Array(n), shade: new Float32Array(n), limb: new Float32Array(n) };
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let y = 0; y < D; y++) {
      for (let x = 0; x < D; x++) {
        const nx = (x + 0.5 - R) / R;
        const ny = (y + 0.5 - R) / R;
        const rr = nx * nx + ny * ny;
        if (rr > 1) continue;
        const nz = Math.sqrt(1 - rr);
        // Undo the axial tilt (rotation about the x axis).
        const wy = -ny * ct + nz * st;
        const wz = ny * st + nz * ct;
        const p = y * D + x;
        table.idx[p] = p;
        table.lat[p] = Math.asin(Math.max(-1, Math.min(1, wy)));
        table.lon[p] = Math.atan2(nx, wz);
        table.shade[p] = nx * Lx + ny * Ly + nz * Lz;
        table.limb[p] = nz;
      }
    }
  }

  function renderDisk() {
    if (!painted) return false;
    const { color, lights } = painted;
    const data = img.data;
    const cl = layers.clouds;
    const n = D * D;
    for (let p = 0; p < n; p++) {
      const o = p * 4;
      if (table.idx[p] < 0) {
        data[o + 3] = 0;
        continue;
      }
      const lon = table.lon[p] + rot;
      const fu = ((lon / TAU) % 1 + 1) % 1;
      const fv = (table.lat[p] + Math.PI / 2) / Math.PI;
      const u2 = Math.floor(fu * UW);
      const v2 = Math.min(UH - 1, Math.floor(fv * UH));
      const c2 = (v2 * UW + u2) * 3;
      const v = v2 >> 1;
      const k = v * TW + (u2 >> 1);
      const s = table.shade[p];
      const day = Math.max(0, s);
      const lit = 0.07 + 0.93 * Math.pow(day, 0.8);
      let r = color[c2] * lit;
      let g = color[c2 + 1] * lit;
      let b = color[c2 + 2] * lit;
      // City lights on the night side only.
      const night = Math.max(0, Math.min(1, (0.12 - s) * 4));
      if (night > 0 && lights[k] > 0) {
        const L = lights[k] * night * 255;
        r += L; g += L * 0.78; b += L * 0.42;
      }
      // Clouds: a second texture drifting at its own speed.
      if (cl > 0.09) {
        let cu = Math.floor((((lon + cloudShift) / TAU) % 1 + 1) % 1 * TW);
        const c = surface.cloud[v * TW + cu];
        const cover = Math.max(0, Math.min(1, (c - (0.72 - cl * 0.55)) * 5));
        if (cover > 0) {
          const cv = 235 * (0.12 + 0.88 * day);
          r = mix(r, cv, cover * 0.85); g = mix(g, cv, cover * 0.85); b = mix(b, cv * 1.02, cover * 0.85);
        }
      }
      // A little darkening toward the edge reads as a sphere.
      const limb = 0.55 + 0.45 * Math.pow(table.limb[p], 0.5);
      data[o] = r * limb; data[o + 1] = g * limb; data[o + 2] = b * limb; data[o + 3] = 255;
    }
    diskCtx.putImageData(img, 0, 0);
    return true;
  }

  function ellipse(cx, cy, rx, ry, rotA, half) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotA);
    if (half) {
      ctx.beginPath();
      ctx.rect(-rx * 2, half === "back" ? -ry * 4 : 0, rx * 4, ry * 4);
      ctx.clip();
    }
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawRing(cx, cy, R, half) {
    if (!layers.ring) return;
    ctx.lineWidth = Math.max(1, R * 0.018);
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(255, 210, 160, ${(0.18 + layers.ring * 0.4) * (1 - i * 0.2)})`;
      ellipse(cx, cy, R * (1.5 + i * 0.07), R * (0.3 + i * 0.014), -0.32, half);
    }
  }

  function drawMoons(cx, cy, R, t, behind) {
    moons.forEach((m, i) => {
      const a = t * (0.00012 + i * 0.000035) + i * 2.1;
      const s = Math.sin(a);
      if (behind !== s < 0) return;
      const orbit = R * (1.42 + i * 0.16);
      const x = cx + Math.cos(a) * orbit;
      const y = cy + s * orbit * 0.28 - Math.cos(a) * orbit * 0.12;
      const size = Math.max(3, R * (0.06 + 0.035 * m.value));
      // A moon is lit from the same side as the world; how much of it is lit
      // is how far along the goal is.
      const g = ctx.createRadialGradient(x - size * 0.4, y - size * 0.4, size * 0.1, x, y, size);
      const lit = 0.25 + 0.75 * m.value;
      g.addColorStop(0, `rgba(250, 246, 232, ${lit})`);
      g.addColorStop(1, `rgba(120, 130, 160, ${0.5 + 0.3 * lit})`);
      ctx.fillStyle = g;
      if (m.done) {
        ctx.shadowColor = "rgba(255, 230, 180, 0.8)";
        ctx.shadowBlur = size * 3;
      }
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  function draw(t) {
    if (!table) return;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.3;
    ctx.clearRect(0, 0, W, H);

    // Atmosphere: thicker and brighter the more you've talked to people.
    const atmo = layers.atmosphere;
    const g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * (1.1 + 0.22 * atmo));
    g.addColorStop(0, `rgba(120, 190, 255, ${0.28 + 0.45 * atmo})`);
    g.addColorStop(1, "rgba(120, 190, 255, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R * (1.1 + 0.22 * atmo), 0, TAU);
    ctx.fill();

    drawRing(cx, cy, R, "back");
    drawMoons(cx, cy, R, t, true);
    if (renderDisk()) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(disk, cx - R, cy - R, R * 2, R * 2);
    }

    // Aurora at the poles: things you made, in the last month.
    if (layers.aurora > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const pulse = 0.75 + 0.25 * Math.sin(t * 0.0016);
      for (const [py, flip] of [[-0.78, 1], [0.86, -1]]) {
        for (let i = 0; i < 3; i++) {
          const a = layers.aurora * pulse * (0.5 - i * 0.12) * (flip < 0 ? 0.6 : 1);
          ctx.strokeStyle = i % 2 ? `rgba(185, 140, 255, ${a})` : `rgba(110, 255, 190, ${a})`;
          ctx.lineWidth = R * (0.06 - i * 0.012);
          ctx.beginPath();
          ctx.ellipse(cx, cy + R * py, R * (0.46 + i * 0.05), R * 0.12, 0, flip > 0 ? Math.PI * 1.05 : 0.05, flip > 0 ? Math.PI * 1.95 : Math.PI * 0.95);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // A thin bright rim.
    ctx.strokeStyle = `rgba(170, 215, 255, ${0.25 + 0.35 * atmo})`;
    ctx.lineWidth = Math.max(1, R * 0.012);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();

    drawRing(cx, cy, R, "front");
    drawMoons(cx, cy, R, t, false);
  }

  const loop = animationLoop(canvas, (t, dt) => {
    frameSkip = !frameSkip;
    if (frameSkip) return; // ~30 fps is plenty for a slow spin
    if (!dragging) rot += dt * 2 * spin * 60;
    cloudShift += dt * 2 * spin * 25;
    draw(t);
  });

  function redrawStill() {
    draw(performance.now());
  }

  if (interactive) {
    canvas.addEventListener("pointerdown", (e) => {
      dragging = { x: e.clientX, rot };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      rot = dragging.rot - (e.clientX - dragging.x) * 0.01;
      if (still()) redrawStill();
    });
    const end = () => (dragging = null);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        rot += e.key === "ArrowLeft" ? 0.25 : -0.25;
        redrawStill();
        e.preventDefault();
      }
    });
  }

  let ro = null;
  if ("ResizeObserver" in window) {
    ro = new ResizeObserver(() => {
      build();
      redrawStill();
    });
    ro.observe(canvas);
  }
  build();
  redrawStill();
  if (!still()) loop.start();
  if (!surface) {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
    idle(() => {
      if (destroyed) return;
      surface = surfaceFor(seed);
      painted = paint(surface, layers);
      redrawStill();
    }, { timeout: 800 });
  }

  return {
    setLayers(next, nextMoons = moons) {
      const repaint = ["land", "lights", "forest", "glow"].some((k) => next[k] !== layers[k]);
      layers = { ...layers, ...next };
      moons = nextMoons || [];
      if (repaint && surface) painted = paint(surface, layers);
      redrawStill();
    },
    destroy() {
      destroyed = true;
      loop.destroy();
      ro?.disconnect();
    },
  };
}
