// Your world is the real Earth, rising from the sea as you work.
//
// A new world is all ocean. Focus raises land -- the real continents, in
// their real shapes, starting from India and spreading outward, each
// landmass growing from its interior to its true coast -- until, after a
// few hundred hours, the whole Earth has risen. Finished tasks light its
// real cities at night, brightest first.
//
// The maps are NASA's Blue Marble (the surface) and Black Marble (city
// lights at night), and Natural Earth's coastlines, all public domain,
// built into three small images by tools/earth/build_earth.py:
//   earth-albedo-N.jpg   surface colour
//   earth-lights-N.jpg   night lights
//   earth-emerge-N.png   the order land rises: 0 is ocean; on land 255
//                        rises first, 1 last (area-weighted: a threshold
//                        of 1 - p shows p of Earth's land)
// Equirectangular, north up, longitude -180..180 left to right.
import { deviceTier } from "./device-tier.js";
import { TW, TH, UW, UH } from "./world-surface.js";

const BASE = new URL("../assets/earth/", import.meta.url);

/** The size of map this device loads: smaller on weak devices. */
export function earthSize() {
  return deviceTier().tier === "low" ? 1024 : 2048;
}

/**
 * The size for a GPU globe: no bigger than the world on screen needs
 * (`diskPx`, its width in device pixels; a map about pi times that is
 * sharp at the centre), the GPU takes, and the device can afford (4096
 * only on strong devices).
 */
export function earthSizeFor(gl, diskPx = 0) {
  const max = gl?.getParameter?.(gl.MAX_TEXTURE_SIZE) || 0;
  const most = deviceTier().tier === "high" && max >= 4096 ? 4096 : earthSize();
  if (!diskPx) return most;
  const need = diskPx * 2.6;
  return Math.min(most, need <= 1024 ? 1024 : need <= 2048 ? 2048 : 4096);
}

/** The first maps a globe shows: small, so the world appears at once. */
export const FIRST_SIZE = 1024;

const cache = new Map(); // key -> Promise

function image(name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
    img.onerror = () => reject(new Error(`Earth map ${name} didn't load`));
    img.src = new URL(name, BASE).href;
  });
}

const once = (key, make) => {
  if (!cache.has(key)) {
    const p = make();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
};

/** The three maps a world needs (colour, night lights, land), once per size. */
export function loadEarthCore(size = earthSize()) {
  return once(`core-${size}`, () =>
    Promise.all([image(`earth-albedo-${size}.jpg`), image(`earth-lights-${size}.jpg`), image(`earth-emerge-${size}.png`)]).then(([albedo, lights, emerge]) => ({ albedo, lights, emerge, size }))
  );
}

/**
 * The relief and the real clouds (v0.3): extras, each null if it doesn't
 * arrive; a world draws without them.
 */
export function loadEarthExtras(size = earthSize()) {
  const extra = (name) => image(name).catch(() => null);
  return once(`extras-${size}`, () => Promise.all([extra(`earth-relief-${size}.jpg`), extra(`earth-clouds-${size === 1024 ? 1024 : 2048}.jpg`)]).then(([relief, clouds]) => ({ relief, clouds, size })));
}

/** All the maps of one size. */
export function loadEarth(size = earthSize()) {
  return Promise.all([loadEarthCore(size), loadEarthExtras(size)]).then(([core, extras]) => ({ ...core, ...extras }));
}

/**
 * How much of Earth's land has risen (0..1) and how many of its city
 * lights are on (0..1), from a world's layers (model/world-model.js). Older
 * callers that only set `land` get a sensible reading of it.
 */
export function earthLevels(layers = {}) {
  const rise = layers.earth ?? Math.max(0, Math.min(1, ((layers.land ?? 0.06) - 0.06) / 0.4));
  const lit = layers.cities ?? Math.max(0, Math.min(1, 1 - Math.exp(-(layers.lights || 0) / 120)));
  return { rise, lit };
}

// ---- For the 2D renderer -----------------------------------------------------------------

let pixels = null; // { albedo, lights, emerge } as byte arrays at UW x UH, south row first

/** The maps as pixel arrays the 2D renderer can sample (once). */
export async function earthPixels() {
  if (pixels) return pixels;
  const maps = await loadEarth(1024);
  const read = (img, channels) => {
    const c = document.createElement("canvas");
    c.width = UW;
    c.height = UH;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    // Flip so the first row is the south, and turn half a world so
    // longitude 0 sits at u = 0 (the renderers' convention).
    ctx.translate(0, UH);
    ctx.scale(1, -1);
    ctx.drawImage(img, UW / 2, 0, UW, UH);
    ctx.drawImage(img, -UW / 2, 0, UW, UH);
    const d = ctx.getImageData(0, 0, UW, UH).data;
    const out = new Uint8Array(UW * UH * channels);
    for (let i = 0, j = 0; i < UW * UH; i++) {
      if (channels === 3) {
        out[j++] = d[i * 4];
        out[j++] = d[i * 4 + 1];
        out[j++] = d[i * 4 + 2];
      } else out[j++] = d[i * 4];
    }
    return out;
  };
  pixels = { albedo: read(maps.albedo, 3), lights: read(maps.lights, 1), emerge: read(maps.emerge, 1) };
  return pixels;
}

/** Paint the risen Earth for the 2D renderer: colour at UW x UH, lights at TW x TH. */
export function paintEarth(px, layers) {
  const { rise, lit } = earthLevels(layers);
  // Nothing has risen at all until the first focus (the very first land
  // would otherwise show at a threshold of 255).
  const cut = rise > 0 ? (1 - rise) * 255 : 256;
  const color = new Uint8ClampedArray(UW * UH * 3);
  for (let i = 0; i < UW * UH; i++) {
    const e = px.emerge[i];
    const up = e > 0 && e >= cut;
    if (up) {
      color[i * 3] = px.albedo[i * 3];
      color[i * 3 + 1] = px.albedo[i * 3 + 1];
      color[i * 3 + 2] = px.albedo[i * 3 + 2];
    } else {
      // The sea: one deep ocean at first, the real seafloor (the map's
      // depths) showing through as land rises -- never the outline of a
      // continent still under water.
      const k = e === 0 ? 0.1 + 0.9 * rise : 0;
      color[i * 3] = 8 + (px.albedo[i * 3] * 0.8 - 8) * k;
      color[i * 3 + 1] = 30 + (px.albedo[i * 3 + 1] * 0.8 - 30) * k;
      color[i * 3 + 2] = 60 + (px.albedo[i * 3 + 2] * 0.85 - 60) * k;
    }
  }
  const lights = new Float32Array(TW * TH);
  if (lit > 0) {
    const show = 0.92 * (1 - lit);
    for (let j = 0; j < TH; j++) {
      for (let i = 0; i < TW; i++) {
        const s = (j * 2) * UW + i * 2;
        const e = px.emerge[s];
        if (!(e > 0 && e >= cut)) continue;
        const v = px.lights[s] / 255;
        if (v > show) lights[j * TW + i] = Math.min(1, v * 1.4);
      }
    }
  }
  return { color, lights };
}
