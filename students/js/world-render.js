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
import { glSupported, createGlobeGL } from "./world-gl.js";
import { TW, TH, UW, UH, TAU, mix, surfaces, surfaceFor, paint } from "./world-surface.js";
import { getLight, onLight, lightVector } from "./world-light.js";

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{seed: string, tilt?: number, interactive?: boolean, maxDisk?: number}} opts
 */
/**
 * Draw a world on `canvas`: on the GPU when the browser can (world-gl.js),
 * otherwise with the 2D renderer below. Same contract either way.
 */
export function createGlobe(canvas, opts = {}) {
  if (!opts.force2d && glSupported()) {
    const g = createGlobeGL(canvas, opts);
    if (g) return g;
  }
  return createGlobe2D(canvas, opts);
}

function createGlobe2D(canvas, { seed, tilt = 0.38, interactive = false, maxDisk = 300, spin = 1, onMotion } = {}) {
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
  // The same motion controls as the WebGL world, minus tipping and zoom.
  const home = { speed: spin, direction: 1, paused: false, pitch: 0, zoom: 1 };
  const motion = { ...home };
  let acc = 0;
  const still = () => reducedMotion();

  // Where the sun is and how bright the night side is: the person's choice
  // (world-light.js). Screen y points down here, so the sun's y flips.
  let lighting = getLight();
  let Lx, Ly, Lz, ambient;
  const aim = () => {
    [Lx, Ly, Lz] = lightVector(lighting);
    Ly = -Ly;
    ambient = 0.05 + 0.4 * lighting.night * lighting.night;
  };
  aim();
  const offLight = onLight((l) => {
    lighting = l;
    aim();
    build();
    redrawStill();
  });

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
      const lit = ambient + (1 - ambient) * Math.pow(day, 0.8);
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
    acc += dt;
    if (frameSkip) return; // ~30 fps is plenty for a slow spin
    const step = acc / 1000;
    acc = 0;
    const rate = motion.paused ? 0 : 0.16 * motion.speed * motion.direction;
    if (!dragging) rot += rate * step;
    cloudShift += (0.012 + Math.abs(rate) * 0.15) * step;
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
      offLight();
      loop.destroy();
      ro?.disconnect();
    },
    setMotion(next) {
      Object.assign(motion, next);
      onMotion?.({ ...motion });
      redrawStill();
    },
    getMotion: () => ({ ...motion }),
    zoomBy() {},
    reset() {
      Object.assign(motion, home);
      onMotion?.({ ...motion });
    },
    renderer: "2d",
  };
}
