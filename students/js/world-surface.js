// The planet's surface, generated from a seed: shared by the WebGL renderer
// (world-gl.js) and the 2D one (world-render.js), so a world looks the same
// whichever draws it.
//
// Generated once per seed into a 256x128 texture (3D value noise sampled on
// the sphere, so there is no seam) and cached for the session. Changing a
// layer (more land, more lights) recolours that texture; nothing is
// regenerated.

export const TW = 256;
export const TH = 128;
export const TAU = Math.PI * 2;

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
export const surfaces = new Map();
export function surfaceFor(seedText) {
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

export function thresholdFor(surface, fraction) {
  const { order, cum, height } = surface;
  let lo = 0, hi = order.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < fraction) lo = mid + 1;
    else hi = mid;
  }
  return height[order[lo]];
}

export const mix = (a, b, t) => a + (b - a) * t;

// Colour the surface for a set of layers. Returns RGB and a light map.
export function paint(surface, L) {
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
        // The same palette as the GPU world: olive and forest-dark where
        // it's green, ochre where it's dry, grey rock, then snow.
        if (green) {
          r = mix(40, 88, up); g = mix(58, 82, up); b = mix(28, 62, up);
        } else {
          r = mix(158, 120, up); g = mix(116, 100, up); b = mix(72, 80, up);
        }
        if (up > 0.82) { r = mix(r, 214, (up - 0.82) * 5); g = mix(g, 220, (up - 0.82) * 5); b = mix(b, 228, (up - 0.82) * 5); }
      } else {
        const depth = Math.min(1, (sea - h) / 0.22);
        r = mix(16, 4, depth); g = mix(54, 16, depth); b = mix(82, 40, depth);
        // Reading lights the shallows: a cyan glow along the coasts.
        if (L.glow > 0) {
          const near = Math.max(0, 1 - depth * 3.2) * L.glow;
          r = mix(r, 24, near); g = mix(g, 120, near); b = mix(b, 112, near);
        }
      }
      if (lat > 0.86) { // ice caps
        const ice = Math.min(1, (lat - 0.86) * 9);
        r = mix(r, 196, ice); g = mix(g, 206, ice); b = mix(b, 218, ice);
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
export const UW = TW * 2;
export const UH = TH * 2;
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
