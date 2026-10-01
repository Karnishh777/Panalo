// The world, drawn by the GPU.
//
// One fragment shader ray-traces the whole scene for each pixel: the planet,
// a ring that passes behind it and sits in its shadow (and shades it back),
// and moons that pass in front and behind. There are no meshes and no
// libraries.
//
// Two scales of detail:
//   - the continents, moisture and cloud systems come from the same seeded
//     generator as the 2D renderer (world-surface.js), uploaded once as small
//     textures -- so a world has the same shape whichever renderer draws it;
//   - everything finer is made per pixel from a tiling noise texture sampled
//     three ways around the sphere (no seams, no poles): fractal coastlines,
//     ridges, beaches and shallows, wind-torn cloud edges, city lights,
//     craters on the moons. That's why it stays sharp at any size.
// Every layer of your life (land, lights, aurora...) is a uniform, so a
// change is a few numbers, not a new texture.
//
// WebGL 1, so it runs on old phones and school laptops. If anything about it
// fails, createGlobe() falls back to the 2D renderer.
import { reducedMotion, animationLoop } from "./motion.js";
import { surfaceFor, paint, thresholdFor, TW, TH } from "./world-surface.js";
import { getLight, onLight, lightVector } from "./world-light.js";

const MAX_MOONS = 6;
const EXTENT = 1.7; // half the canvas, in planet radii, at zoom 1
const BASE_RATE = 0.16; // radians a second at speed 1

const VERT = `
attribute vec2 aPos;
varying vec2 vP;
void main() {
  vP = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vP;
uniform sampler2D uHeight;  // continents
uniform sampler2D uLights;  // one light per finished task
uniform sampler2D uClouds;  // weather systems
uniform sampler2D uMoist;   // where forests grow
uniform sampler2D uNoise;   // tiling detail noise, 3 channels
uniform float uExtent, uAspect, uRot, uCloudShift, uTime, uTilt, uSea;
uniform float uAtmo, uAurora, uCloudCover, uRing, uForest, uGlow, uNight;
uniform vec3 uLight;        // towards the sun, view space
uniform vec3 uRingN;        // ring plane normal, view space
uniform vec4 uMoon[${MAX_MOONS}];     // xyz centre, w radius (0 = none)
uniform vec2 uMoonVal[${MAX_MOONS}];  // x progress, y done

const float PI = 3.14159265;
vec3 W; // triplanar weights for the current point

vec3 toPlanet(vec3 n) {   // view space -> the planet's frame (axial tilt)
  float c = cos(uTilt), s = sin(uTilt);
  return vec3(n.x, n.y * c + n.z * s, -n.y * s + n.z * c);
}
vec3 spinY(vec3 f, float a) {  // the planet's own frame, turned with it
  float c = cos(a), s = sin(a);
  return vec3(f.x * c + f.z * s, f.y, f.z * c - f.x * s);
}
vec2 uvOf(vec3 f, float spin) {
  float lon = atan(f.x, f.z) + spin;
  float lat = asin(clamp(f.y, -1.0, 1.0));
  return vec2(fract(lon / (2.0 * PI)), lat / PI + 0.5);
}

// Detail noise: the tile seen along each axis, blended by the surface
// direction. p is in noise cells (32 per tile).
void weights(vec3 n) {
  W = pow(abs(n), vec3(4.0));
  W /= (W.x + W.y + W.z);
}
float tn(vec3 p) {
  return W.x * texture2D(uNoise, p.yz * 0.03125).r
       + W.y * texture2D(uNoise, p.zx * 0.03125 + 0.37).g
       + W.z * texture2D(uNoise, p.xy * 0.03125 + 0.71).b;
}
vec3 tn3(vec3 p) {
  return W.x * texture2D(uNoise, p.yz * 0.03125).rgb
       + W.y * texture2D(uNoise, p.zx * 0.03125 + 0.37).gbr
       + W.z * texture2D(uNoise, p.xy * 0.03125 + 0.71).brg;
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * tn(p);
    n += a;
    a *= 0.5;
    p = p * 2.07 + vec3(1.7, 9.2, 3.1);
  }
  return s / n;
}

vec4 shadePlanet(vec2 p, float zp) {
  vec3 n = vec3(p, zp);
  vec3 f = toPlanet(n);
  vec3 L = normalize(toPlanet(uLight));
  vec3 V = toPlanet(vec3(0.0, 0.0, 1.0));
  vec2 uv = uvOf(f, uRot);
  vec3 P = spinY(f, uRot);          // fixed to the ground
  weights(P);

  // Height: the continent from the texture, coastlines and ridges per pixel.
  float h = texture2D(uHeight, uv).r;
  float d1 = fbm(P * 9.0, 4);
  float hd = h + (d1 - 0.5) * 0.06;
  float land = smoothstep(uSea - 0.0025, uSea + 0.0025, hd);
  float up = clamp((hd - uSea) / 0.18, 0.0, 1.0);

  // Relief: the continent's slope plus the detail's own slope.
  float du = 1.0 / ${TW}.0, dv = 1.0 / ${TH}.0;
  float hx = texture2D(uHeight, uv + vec2(du, 0.0)).r - texture2D(uHeight, uv - vec2(du, 0.0)).r;
  float hy = texture2D(uHeight, uv + vec2(0.0, dv)).r - texture2D(uHeight, uv - vec2(0.0, dv)).r;
  float lon = atan(f.x, f.z), lat = asin(clamp(f.y, -1.0, 1.0));
  vec3 east = vec3(cos(lon), 0.0, -sin(lon));
  vec3 north = vec3(-sin(lat) * sin(lon), cos(lat), -sin(lat) * cos(lon));
  vec3 Pe = spinY(east, uRot), Pn = spinY(north, uRot);
  float ridge = 1.0 - abs(2.0 * fbm(P * 22.0, 3) - 1.0);
  float rx = fbm((P + Pe * 0.004) * 22.0, 2) - fbm((P - Pe * 0.004) * 22.0, 2);
  float ry = fbm((P + Pn * 0.004) * 22.0, 2) - fbm((P - Pn * 0.004) * 22.0, 2);
  float rough = land * (0.25 + 0.9 * up);
  vec3 nb = normalize(f - land * (6.0 * (hx * east + hy * north) + rough * 1.2 * (rx * east + ry * north)));

  // Land: beaches, lowlands green or dry by moisture, rock higher up, snow on top.
  float moist = texture2D(uMoist, uv).r + (fbm(P * 6.0, 3) - 0.5) * 0.22;
  float green = smoothstep(uForest + 0.14, uForest - 0.1, moist);
  float lush = smoothstep(uForest - 0.05, uForest - 0.3, moist);
  float fine = fbm(P * 48.0, 2);
  vec3 dry = mix(vec3(0.7, 0.58, 0.4), vec3(0.58, 0.47, 0.33), fbm(P * 15.0, 2));
  vec3 grass = mix(vec3(0.36, 0.5, 0.27), vec3(0.12, 0.33, 0.17), lush);
  vec3 lowland = mix(dry, grass, green);
  lowland = mix(lowland, lowland * vec3(0.8, 0.9, 0.82), smoothstep(0.45, 0.75, fine) * green);
  vec3 rock = mix(vec3(0.48, 0.4, 0.32), vec3(0.38, 0.33, 0.28), ridge);
  vec3 landCol = mix(lowland, rock, smoothstep(0.5, 0.85, up + (ridge - 0.5) * 0.2));
  landCol *= 0.84 + 0.32 * fine;
  landCol = mix(vec3(0.84, 0.77, 0.58), landCol, smoothstep(0.0, 0.025, up));
  float snow = smoothstep(0.9, 0.97, up + (d1 - 0.5) * 0.2 + ridge * 0.05);
  landCol = mix(landCol, vec3(0.95, 0.97, 1.0), snow);

  // Sea: deep blue, turquoise shallows, a glow along the coasts from reading.
  float depth = clamp((uSea - hd) / 0.22, 0.0, 1.0);
  vec3 seaCol = mix(vec3(0.07, 0.3, 0.52), vec3(0.015, 0.07, 0.2), sqrt(depth));
  seaCol = mix(vec3(0.1, 0.5, 0.58), seaCol, smoothstep(0.0, 0.06, depth));
  seaCol = mix(seaCol, vec3(0.3, 0.95, 0.88), uGlow * max(0.0, 1.0 - depth * 3.2));

  vec3 albedo = mix(seaCol, landCol, land);
  float ice = smoothstep(0.962, 0.982, abs(P.y) + (d1 - 0.5) * 0.04);
  albedo = mix(albedo, vec3(0.92, 0.95, 1.0), ice);

  // Waves: a moving ripple on the water's normal, for the glint to break on.
  vec3 wp = P * 140.0 + vec3(uTime * 0.25, 0.0, uTime * 0.18);
  vec3 wv = tn3(wp) - 0.5;
  vec3 nw = normalize(nb + (1.0 - land) * (1.0 - ice) * 0.09 * (wv.x * east + wv.y * north));

  // Clouds: big systems from the texture, torn edges from detail noise.
  vec3 C = spinY(f, uRot + uCloudShift);
  vec2 cuv = uvOf(f, uRot + uCloudShift);
  vec3 warp = tn3(C * 4.0) - 0.5;
  float cdet = fbm(C * 13.0 + warp * 3.0, 4);
  float cbase = texture2D(uClouds, cuv).r;
  float dens = cbase * 0.62 + cdet * 0.52 - 0.07;
  float cut = 0.74 - uCloudCover * 0.55;
  float on = step(0.09, uCloudCover);
  float cover = on * smoothstep(cut, cut + 0.07, dens);
  float thick = on * smoothstep(cut, cut + 0.28, dens);
  vec3 fs = normalize(f - L * 0.03);
  vec3 S = spinY(fs, uRot + uCloudShift);
  float sdens = texture2D(uClouds, uvOf(fs, uRot + uCloudShift)).r * 0.62 + fbm(S * 13.0 + warp * 3.0, 2) * 0.52 - 0.07;
  float shadow = on * smoothstep(cut, cut + 0.1, sdens);

  // The ring's shadow on the planet: follow the sunlight back to the ring plane.
  float ringShade = 1.0;
  if (uRing > 0.0) {
    vec3 Lv = normalize(uLight);
    float den = dot(Lv, uRingN);
    if (abs(den) > 1e-3) {
      float t = -dot(n, uRingN) / den;
      if (t > 0.0) {
        float rd = length(n + Lv * t);
        float rb = 0.55 + 0.45 * sin(rd * 70.0) * sin(rd * 23.0 + 1.3);
        float re = smoothstep(1.3, 1.34, rd) * smoothstep(1.68, 1.62, rd);
        ringShade = 1.0 - uRing * re * rb * 0.6;
      }
    }
  }

  float d = dot(f, L);                         // the terminator
  float diff = max(dot(nw, L), 0.0);
  vec3 sun = mix(vec3(1.0, 0.6, 0.36), vec3(1.0), smoothstep(0.0, 0.35, d));
  // The night side: as dark as space, or lit by a cool moonlight -- your choice.
  vec3 moonlit = vec3(0.5, 0.62, 1.0) * (0.025 + 0.42 * uNight * uNight) * (0.6 + 0.4 * max(dot(nw, -L) * 0.5 + 0.5, 0.0));
  vec3 col = albedo * (sun * 1.08 * diff * ringShade + moonlit) * (1.0 - 0.4 * shadow * step(0.0, d));

  // Sun on water: a tight glint and a broad sheen, brighter towards the rim.
  vec3 H = normalize(L + V);
  float nh = max(dot(nw, H), 0.0);
  float water = (1.0 - land) * (1.0 - ice) * smoothstep(-0.05, 0.2, d) * ringShade * (1.0 - cover);
  float fw = 0.25 + 0.75 * pow(1.0 - zp, 4.0);
  col += vec3(1.0, 0.93, 0.8) * (pow(nh, 420.0) * 0.4 + pow(nh, 26.0) * 0.1 * fw) * water;
  col = mix(col, col * vec3(0.8, 0.9, 1.08), (1.0 - land) * (1.0 - zp) * 0.6);

  // Night side: cities where the lights are, sparkling in clusters.
  float night = smoothstep(0.12, -0.18, d);
  float lights = texture2D(uLights, uv).r;
  float town = smoothstep(0.5, 0.78, tn(P * 95.0)) + 0.5 * smoothstep(0.62, 0.8, tn(P * 210.0));
  float city = min(1.0, lights * 3.0) * (0.25 + 1.4 * town) * land;
  col += vec3(1.0, 0.7, 0.36) * city * night * 1.5 * (1.0 - 0.75 * cover);

  // Clouds over everything: lit tops, darker undersides at the edges.
  vec3 cloudCol = mix(vec3(0.72, 0.76, 0.84), vec3(1.0), thick) * (sun * 0.95 * max(d, 0.0) * ringShade + 0.03 + moonlit * 1.4);
  col = mix(col, cloudCol, cover * (0.55 + 0.4 * thick));

  // Aurora: things you made, curtains over both poles.
  float alat = abs(lat) * 180.0 / PI;
  float band = smoothstep(58.0, 65.0, alat) * smoothstep(80.0, 70.0, alat);
  float plon = atan(P.x, P.z);
  float curtain = 0.5 + 0.5 * sin(plon * 9.0 + uTime * 1.3 + sin(plon * 3.0 - uTime * 0.7) * 2.4);
  curtain *= 0.6 + 0.4 * tn(vec3(plon * 6.0, uTime * 0.6, alat * 0.3));
  vec3 auroraCol = mix(vec3(0.3, 1.0, 0.7), vec3(0.75, 0.45, 1.0), 0.5 + 0.5 * sin(plon * 2.0 + uTime * 0.4));
  col += auroraCol * uAurora * band * curtain * (0.35 + 1.0 * night);

  // Atmosphere: a blue rim, warm where day turns to night.
  float fres = pow(1.0 - zp, 3.0);
  vec3 sky = mix(vec3(0.95, 0.5, 0.28), vec3(0.42, 0.7, 1.0), smoothstep(-0.1, 0.35, d));
  col += sky * fres * (0.22 + 0.9 * uAtmo) * smoothstep(-0.25, 0.25, d);
  // Backlit: with the sun behind the world, the air at the rim lights up.
  float fwd = pow(max(dot(-V, L), 0.0), 3.0);
  col += vec3(1.0, 0.74, 0.48) * pow(fres, 1.4) * fwd * (0.6 + 0.9 * uAtmo);
  return vec4(col, 1.0);
}

void main() {
  vec2 p = vec2(vP.x * uAspect, vP.y) * uExtent;
  float r2 = dot(p, p);
  vec3 L = normalize(uLight);

  // Halo outside the planet: thicker with more time spent with people.
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (r2 > 1.0) {
    float r = sqrt(r2);
    float lit = 0.3 + 0.7 * max(dot(normalize(vec3(p, 0.0)), L), 0.0);
    float back = pow(max(-L.z, 0.0), 1.5); // the sun behind: a ring of fire
    float g = exp(-(r - 1.0) * (14.0 - 6.0 * uAtmo)) * (0.18 + 0.62 * uAtmo) * (lit + 2.2 * back * (0.35 + 0.65 * max(dot(normalize(vec3(p, 0.0)), normalize(vec3(L.xy, 0.0) + 1e-4)), 0.0)));
    col = mix(vec3(0.45, 0.7, 1.0), vec3(1.0, 0.72, 0.45), back * 0.7) * g;
    a = g;
  }

  // Planet.
  float zp = r2 <= 1.0 ? sqrt(1.0 - r2) : -1e9;
  vec4 planet = zp > -1e8 ? shadePlanet(p, zp) : vec4(0.0);

  // Ring: where this pixel's ray crosses the ring plane. Many fine bands,
  // one dark gap, and a glow when the sun is behind it.
  float zr = -1e9;
  vec4 ring = vec4(0.0);
  if (uRing > 0.0 && abs(uRingN.z) > 1e-3) {
    float z = -(uRingN.x * p.x + uRingN.y * p.y) / uRingN.z;
    vec3 q = vec3(p, z);
    float d = length(q);
    if (d > 1.3 && d < 1.68) {
      float bands = 0.62 + 0.2 * sin(d * 61.0) + 0.12 * sin(d * 147.0 + 1.3) + 0.06 * sin(d * 289.0 + 0.4);
      bands *= smoothstep(0.004, 0.014, abs(d - 1.5));       // the gap
      bands *= mix(0.55, 1.0, smoothstep(1.3, 1.42, d));      // a fainter inner ring
      float edge = smoothstep(1.3, 1.33, d) * smoothstep(1.68, 1.63, d);
      float alpha = clamp(uRing * edge * bands * 0.95, 0.0, 1.0);
      float b = dot(q, L);
      float c = dot(q, q) - 1.0;
      float shade = (b * b - c > 0.0 && -b + sqrt(b * b - c) > 0.0 && b < 0.0) ? 0.18 : 1.0;
      float facing = abs(dot(uRingN, L));
      shade *= 0.5 + 0.5 * facing;
      vec3 tint = mix(vec3(0.86, 0.72, 0.56), vec3(1.0, 0.9, 0.74), 0.5 + 0.5 * sin(d * 37.0));
      ring = vec4(tint * shade * (1.0 + 0.6 * pow(1.0 - facing, 3.0)), alpha);
      zr = z;
    }
  }

  // Moons: lit, cratered, glowing a little once their goal is done.
  float zm = -1e9;
  vec4 moon = vec4(0.0);
  for (int i = 0; i < ${MAX_MOONS}; i++) {
    vec4 m = uMoon[i];
    if (m.w <= 0.0) continue;
    vec2 dp = p - m.xy;
    float dd = dot(dp, dp);
    if (dd < m.w * m.w) {
      float z = m.z + sqrt(m.w * m.w - dd);
      if (z > zm) {
        vec3 mn = vec3(dp, z - m.z) / m.w;
        weights(mn);
        float crater = fbm(mn * 3.0 + float(i) * 7.0, 3);
        float pits = smoothstep(0.62, 0.7, tn(mn * 7.0 + float(i) * 3.0));
        vec3 mb = mn + 0.35 * (tn3(mn * 7.0 + float(i) * 3.0) - 0.5) * pits;
        float lit = max(dot(normalize(mb), L), 0.0);
        float val = uMoonVal[i].x;
        vec3 base = mix(vec3(0.45, 0.48, 0.58), vec3(0.98, 0.95, 0.88), val) * (0.75 + 0.45 * crater);
        vec3 mc = base * (0.08 + 1.0 * lit);
        if (uMoonVal[i].y > 0.5) mc += vec3(1.0, 0.85, 0.55) * 0.3 * pow(1.0 - mn.z, 2.0);
        moon = vec4(mc, 1.0);
        zm = z;
      }
    }
  }

  // Back to front: sort the three depths, then lay them over the halo.
  vec4 l0 = planet; float z0 = zp;
  vec4 l1 = ring;   float z1 = zr;
  vec4 l2 = moon;   float z2 = zm;
  vec4 t; float tz;
  if (z0 > z1) { t = l0; l0 = l1; l1 = t; tz = z0; z0 = z1; z1 = tz; }
  if (z1 > z2) { t = l1; l1 = l2; l2 = t; tz = z1; z1 = z2; z2 = tz; }
  if (z0 > z1) { t = l0; l0 = l1; l1 = t; tz = z0; z0 = z1; z1 = tz; }
  col = l0.rgb * l0.a + col * (1.0 - l0.a); a = l0.a + a * (1.0 - l0.a);
  col = l1.rgb * l1.a + col * (1.0 - l1.a); a = l1.a + a * (1.0 - l1.a);
  col = l2.rgb * l2.a + col * (1.0 - l2.a); a = l2.a + a * (1.0 - l2.a);

  // A filmic curve so lights and glints roll off instead of clipping.
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`World shader: ${log}`);
  }
  return s;
}

function program(gl) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`World shader: ${gl.getProgramInfoLog(p)}`);
  return p;
}

// Can this browser draw it? Asked once, on a throwaway canvas, because a
// canvas that has handed out a WebGL context can never become a 2D one.
let supported = null;
//
// Software-only WebGL (no GPU) is refused: the 2D renderer is faster there.
// For testing, localStorage "panalo.students.gl" = "force" accepts it and
// "off" always uses 2D.
export function glSupported() {
  if (supported !== null) return supported;
  let pref = "";
  try {
    pref = localStorage.getItem("panalo.students.gl") || "";
  } catch {}
  if (pref === "off") return (supported = false);
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl", pref === "force" ? {} : { failIfMajorPerformanceCaveat: true }) || null;
    if (!gl) return (supported = false);
    program(gl);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    supported = true;
  } catch (e) {
    console.warn("World: WebGL unavailable, using the 2D renderer.", e);
    supported = false;
  }
  return supported;
}

// A 256x256 tile of smooth value noise, three independent channels, that
// wraps at every edge -- the source of all per-pixel detail. Made once.
let noiseTile = null;
function makeNoiseTile() {
  if (noiseTile) return noiseTile;
  const N = 256, CELLS = 32, S = N / CELLS;
  const out = new Uint8Array(N * N * 3);
  let a = 0x2545f491;
  const rnd = () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    return (a >>> 0) / 4294967296;
  };
  const q = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let c = 0; c < 3; c++) {
    const lat = Float32Array.from({ length: CELLS * CELLS }, rnd);
    const at = (x, y) => lat[(y % CELLS) * CELLS + (x % CELLS)];
    for (let y = 0; y < N; y++) {
      const gy = y / S, y0 = Math.floor(gy), fy = q(gy - y0);
      for (let x = 0; x < N; x++) {
        const gx = x / S, x0 = Math.floor(gx), fx = q(gx - x0);
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
        const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
        out[(y * N + x) * 3 + c] = Math.round((top + (bot - top) * fy) * 255);
      }
    }
  }
  return (noiseTile = out);
}

function texture(gl, unit, w, h, format, data, { wrapT = gl.CLAMP_TO_EDGE, mip = false } = {}) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

const toBytes = (arr, scale = 255) => {
  const out = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(arr[i] * scale)));
  return out;
};

function rot(v, axis, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const [x, y, z] = v;
  if (axis === "x") return [x, y * c - z * s, y * s + z * c];
  if (axis === "y") return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

/**
 * Same contract as the 2D createGlobe(): { setLayers, destroy }, plus the
 * motion controls { setMotion, getMotion, zoomBy, reset }.
 * `spin` is a speed multiplier (1 = one turn in about 40 seconds).
 * Returns null if WebGL can't be used on this canvas.
 */
export function createGlobeGL(canvas, { seed, tilt = 0.38, interactive = false, spin = 1, maxPixels = 1400, onMotion, manual = false } = {}) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  let prog;
  let u = {};
  function setup() {
    prog = program(gl);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n);
    u = {};
    for (const name of ["uExtent", "uAspect", "uRot", "uCloudShift", "uTime", "uTilt", "uSea", "uAtmo", "uAurora", "uCloudCover", "uRing", "uForest", "uGlow", "uNight", "uLight", "uRingN", "uMoon", "uMoonVal"]) u[name] = U(name);
    ["uHeight", "uLights", "uClouds", "uMoist", "uNoise"].forEach((name, i) => gl.uniform1i(U(name), i + 1));
  }
  try {
    setup();
  } catch (e) {
    console.warn(e);
    return null;
  }

  let layers = { land: 0.2, lights: 0, aurora: 0, forest: 0.4, glow: 0, atmosphere: 0.4, clouds: 0.1, ring: 0 };
  let moons = [];
  let surface = null;
  let sea = 0.5;
  let ready = false;
  let rotA = 0;
  let cloudShift = 0;
  let destroyed = false;
  let lost = false;

  // Motion: a steady turn you can speed up, slow, reverse or pause; drag to
  // spin it (with a flick's momentum) and to tip it towards you; zoom.
  const home = { speed: spin, direction: 1, paused: false, pitch: 0, zoom: 1 };
  const motion = { ...home };
  let pitchNow = 0;
  let zoomNow = 1;
  let fling = 0; // radians a second, decaying
  let dragging = null;

  // Where the sun is, and how bright the night side: the person's choice
  // (world-light.js), shared by every globe, followed live.
  let lighting = getLight();
  let light = lightVector(lighting);
  let lightOverride = false; // a film directing its own sun
  const offLight = onLight((l) => {
    if (lightOverride) return;
    lighting = l;
    light = lightVector(l);
    draw(performance.now());
  });
  // In "live" mode the sun moves with the clock; once a minute is plenty.
  const clock = setInterval(() => {
    if (lighting.mode === "live") {
      light = lightVector(lighting);
      if (reducedMotion()) draw(performance.now());
    }
  }, 60000);
  // The ring plane, seen just above edge-on and rolled a little.
  const ringBase = rot(rot([0, 1, 0], "x", 0.2), "z", -0.32);

  function upload() {
    const painted = paint(surface, layers);
    sea = thresholdFor(surface, Math.max(0.01, Math.min(0.9, layers.land)));
    texture(gl, 2, TW, TH, gl.LUMINANCE, toBytes(painted.lights));
  }

  function prepare() {
    if (destroyed || lost) return;
    surface = surfaceFor(seed);
    texture(gl, 1, TW, TH, gl.LUMINANCE, toBytes(surface.height));
    texture(gl, 3, TW, TH, gl.LUMINANCE, toBytes(surface.cloud));
    texture(gl, 4, TW, TH, gl.LUMINANCE, toBytes(surface.moistRank));
    texture(gl, 5, 256, 256, gl.RGB, makeNoiseTile(), { wrapT: gl.REPEAT, mip: true });
    upload();
    ready = true;
    draw(performance.now());
  }

  function size() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = Math.max(40, Math.round((rect.width || canvas.width) * dpr));
    let h = Math.max(40, Math.round((rect.height || rect.width || canvas.height) * dpr));
    const k = Math.min(1, maxPixels / Math.max(w, h));
    w = Math.round(w * k);
    h = Math.round(h * k);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }

  function moonUniforms(t) {
    const pos = new Float32Array(MAX_MOONS * 4);
    const val = new Float32Array(MAX_MOONS * 2);
    moons.slice(0, MAX_MOONS).forEach((m, i) => {
      const a = t * (0.00012 + i * 0.000035) + i * 2.1;
      const r = Math.min(1.58, 1.3 + i * 0.06);
      let v = [Math.cos(a) * r, 0, Math.sin(a) * r];
      v = rot(v, "x", 0.22 + i * 0.05);
      v = rot(v, "z", -0.32);
      v = rot(v, "x", pitchNow);
      pos.set([v[0], v[1], v[2], 0.055 + 0.035 * (m.value || 0)], i * 4);
      val.set([m.value || 0, m.done ? 1 : 0], i * 2);
    });
    gl.uniform4fv(u.uMoon, pos);
    gl.uniform2fv(u.uMoonVal, val);
  }

  function draw(t) {
    if (destroyed || lost) return;
    size();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!ready) return;
    gl.uniform1f(u.uExtent, EXTENT / zoomNow);
    gl.uniform1f(u.uAspect, canvas.width / canvas.height);
    gl.uniform1f(u.uRot, rotA);
    gl.uniform1f(u.uCloudShift, cloudShift);
    gl.uniform1f(u.uTime, (t / 1000) % 1000);
    gl.uniform1f(u.uTilt, tilt + pitchNow);
    gl.uniform1f(u.uSea, sea);
    gl.uniform1f(u.uAtmo, layers.atmosphere);
    gl.uniform1f(u.uAurora, layers.aurora);
    gl.uniform1f(u.uCloudCover, layers.clouds);
    gl.uniform1f(u.uRing, layers.ring);
    gl.uniform1f(u.uForest, layers.forest);
    gl.uniform1f(u.uGlow, layers.glow);
    gl.uniform1f(u.uNight, lighting.night);
    gl.uniform3fv(u.uLight, light);
    gl.uniform3fv(u.uRingN, rot(ringBase, "x", pitchNow));
    moonUniforms(t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ~30 fps while it simply turns; every frame while someone is handling it.
  let skip = false;
  let acc = 0;
  function advance(t, step) {
    const rate = motion.paused ? 0 : BASE_RATE * motion.speed * motion.direction;
    if (!dragging) rotA += (rate + fling) * step;
    fling *= Math.exp(-step / 0.7);
    pitchNow += (motion.pitch - pitchNow) * (1 - Math.exp(-step / 0.12));
    zoomNow += (motion.zoom - zoomNow) * (1 - Math.exp(-step / 0.15));
    cloudShift += (0.012 + Math.abs(rate) * 0.15) * step;
    draw(t);
  }
  const loop = animationLoop(canvas, (t, dt) => {
    const lively = dragging || Math.abs(fling) > 0.01 || Math.abs(pitchNow - motion.pitch) > 0.001 || Math.abs(zoomNow - motion.zoom) > 0.001;
    acc += dt;
    skip = !skip;
    if (skip && !lively) return;
    const step = acc / 1000;
    acc = 0;
    advance(t, step);
  });

  const still = () => reducedMotion();
  const changed = () => {
    onMotion?.({ ...motion });
    if (still()) {
      pitchNow = motion.pitch;
      zoomNow = motion.zoom;
      draw(performance.now());
    }
  };

  if (interactive) {
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => {
      dragging = { x: e.clientX, y: e.clientY, t: performance.now(), v: 0 };
      fling = 0;
      canvas.setPointerCapture?.(e.pointerId);
      canvas.classList.add("grabbing");
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const now = performance.now();
      const scale = 3.2 / Math.max(120, canvas.getBoundingClientRect().width);
      const dx = (e.clientX - dragging.x) * scale;
      const dy = (e.clientY - dragging.y) * scale;
      rotA -= dx;
      motion.pitch = Math.max(-1.1, Math.min(1.1, motion.pitch + dy * 0.8));
      const dtm = Math.max(1, now - dragging.t);
      dragging.v = dragging.v * 0.6 + (-dx / (dtm / 1000)) * 0.4;
      Object.assign(dragging, { x: e.clientX, y: e.clientY, t: now });
      if (still()) changed();
    });
    const end = () => {
      if (!dragging) return;
      if (performance.now() - dragging.t < 80) fling = Math.max(-12, Math.min(12, dragging.v));
      dragging = null;
      canvas.classList.remove("grabbing");
      changed();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowRight") rotA += k === "ArrowLeft" ? 0.25 : -0.25;
      else if (k === "ArrowUp" || k === "ArrowDown") motion.pitch = Math.max(-1.1, Math.min(1.1, motion.pitch + (k === "ArrowUp" ? -0.15 : 0.15)));
      else if (k === "+" || k === "=") motion.zoom = Math.min(1.9, motion.zoom * 1.15);
      else if (k === "-") motion.zoom = Math.max(0.7, motion.zoom / 1.15);
      else return;
      e.preventDefault();
      changed();
      draw(performance.now());
    });
  }

  // A lost context (a GPU reset, too many tabs) is rebuilt when it returns.
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
    loop.stop();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    ready = false;
    try {
      setup();
    } catch {
      return;
    }
    prepare();
    if (!still()) loop.start();
  });

  let ro = null;
  if ("ResizeObserver" in window) {
    ro = new ResizeObserver(() => draw(performance.now()));
    ro.observe(canvas);
  }

  // Generating the planet takes a moment on a slow device: do it when idle.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
  if (manual) prepare(); // a film needs the world now, and drives its frames
  else idle(prepare, { timeout: 800 });
  draw(performance.now());
  if (!still() && !manual) loop.start();

  return {
    setLayers(next, nextMoons = moons) {
      const repaint = ["land", "lights"].some((k) => next[k] !== layers[k]);
      layers = { ...layers, ...next };
      moons = nextMoons || [];
      if (repaint && ready) upload();
      draw(performance.now());
    },
    /** {speed: 0..8, direction: 1 | -1, paused: boolean} */
    setMotion(next) {
      Object.assign(motion, next);
      changed();
    },
    getMotion: () => ({ ...motion }),
    /** For a film: advance and draw one frame now (manual mode). */
    frame(t, dtMs) {
      advance(t, dtMs / 1000);
    },
    /** For a film: aim the sun directly, ignoring the saved choice. */
    setSun(vec, night = lighting.night) {
      lightOverride = true;
      const l = Math.hypot(...vec) || 1;
      light = vec.map((x) => x / l);
      lighting = { ...lighting, night };
    },
    /** For a film: tip and zoom without easing. */
    setView({ pitch, zoom } = {}) {
      if (pitch !== undefined) pitchNow = motion.pitch = pitch;
      if (zoom !== undefined) zoomNow = motion.zoom = zoom;
    },
    canvas,
    zoomBy(f) {
      motion.zoom = Math.max(0.7, Math.min(1.9, motion.zoom * f));
      changed();
    },
    reset() {
      Object.assign(motion, home);
      fling = 0;
      changed();
    },
    destroy() {
      destroyed = true;
      loop.destroy();
      ro?.disconnect();
      offLight();
      clearInterval(clock);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
    renderer: "webgl",
  };
}
