// The world, drawn by the GPU.
//
// One fragment shader ray-traces the whole scene for each pixel: the planet
// (terrain relief from the height map, sunlight glinting off the seas, city
// lights only on the night side, clouds that cast shadows, aurora over the
// poles, scattering at the rim), a ring that passes behind the planet and
// sits in its shadow, and moons that pass in front and behind. There are no
// meshes and no libraries: the surface comes from the same seeded generator
// as the 2D renderer (world-render.js), uploaded once as textures, and every
// layer's strength is a uniform -- so a change in your life is a few numbers,
// not a new texture.
//
// WebGL 1, so it runs on old phones and school laptops. If anything about it
// fails, createGlobe() falls back to the 2D renderer.
import { reducedMotion, animationLoop } from "./motion.js";
import { surfaceFor, paint, thresholdFor, TW, TH, UW, UH } from "./world-surface.js";

const MAX_MOONS = 6;
const EXTENT = 1.7; // half the canvas, in planet radii
const TAU = Math.PI * 2;

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
uniform sampler2D uColor;   // painted surface, 2x upsampled
uniform sampler2D uHeight;  // terrain height
uniform sampler2D uLights;  // one light per finished task
uniform sampler2D uClouds;  // cloud noise; coverage is a uniform
uniform float uExtent, uAspect, uRot, uCloudShift, uTime, uTilt, uSea;
uniform float uAtmo, uAurora, uCloudCover, uRing;
uniform vec3 uLight;        // towards the sun, view space
uniform vec3 uRingN;        // ring plane normal, view space
uniform vec4 uMoon[${MAX_MOONS}];     // xyz centre, w radius (0 = none)
uniform vec2 uMoonVal[${MAX_MOONS}];  // x progress, y done

const float PI = 3.14159265;

vec3 toPlanet(vec3 n) {   // view space -> the planet's frame (axial tilt)
  float c = cos(uTilt), s = sin(uTilt);
  return vec3(n.x, n.y * c + n.z * s, -n.y * s + n.z * c);
}

vec2 uvOf(vec3 f, float spin) {
  float lon = atan(f.x, f.z) + spin;
  float lat = asin(clamp(f.y, -1.0, 1.0));
  return vec2(fract(lon / (2.0 * PI)), lat / PI + 0.5);
}

vec4 shadePlanet(vec2 p, float zp) {
  vec3 n = vec3(p, zp);
  vec3 f = toPlanet(n);
  vec3 L = normalize(toPlanet(uLight));
  vec3 V = toPlanet(vec3(0.0, 0.0, 1.0));
  vec2 uv = uvOf(f, uRot);

  // Relief: bend the normal by the height map's slope, on land only.
  float du = 1.0 / ${TW}.0, dv = 1.0 / ${TH}.0;
  float h = texture2D(uHeight, uv).r;
  float land = smoothstep(uSea - 0.004, uSea + 0.004, h);
  float hx = texture2D(uHeight, uv + vec2(du, 0.0)).r - texture2D(uHeight, uv - vec2(du, 0.0)).r;
  float hy = texture2D(uHeight, uv + vec2(0.0, dv)).r - texture2D(uHeight, uv - vec2(0.0, dv)).r;
  float lon = atan(f.x, f.z), lat = asin(clamp(f.y, -1.0, 1.0));
  vec3 east = vec3(cos(lon), 0.0, -sin(lon));
  vec3 north = vec3(-sin(lat) * sin(lon), cos(lat), -sin(lat) * cos(lon));
  vec3 nb = normalize(f - land * 6.0 * (hx * east + hy * north));

  float d = dot(f, L);                         // the terminator
  float diff = max(dot(nb, L), 0.0);
  vec3 albedo = texture2D(uColor, uv).rgb;

  // Clouds and their shadows, drifting at their own pace.
  float cut = 0.72 - uCloudCover * 0.55;
  vec2 cuv = uvOf(f, uRot + uCloudShift);
  float cover = uCloudCover > 0.09 ? smoothstep(cut, cut + 0.14, texture2D(uClouds, cuv).r) : 0.0;
  vec2 suv = uvOf(normalize(f - L * 0.025), uRot + uCloudShift);
  float shadow = uCloudCover > 0.09 ? smoothstep(cut, cut + 0.14, texture2D(uClouds, suv).r) : 0.0;

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
        float re = smoothstep(1.32, 1.36, rd) * smoothstep(1.66, 1.6, rd);
        ringShade = 1.0 - uRing * re * rb * 0.6;
      }
    }
  }

  // Light reddens as it grazes the terminator, like a long sunset.
  vec3 sun = mix(vec3(1.0, 0.62, 0.38), vec3(1.0), smoothstep(0.0, 0.35, d));
  vec3 col = albedo * sun * (0.035 + 1.05 * diff * ringShade) * (1.0 - 0.35 * shadow * step(0.0, d));

  // Sun on water: a tight glint and a broad sheen, brighter towards the rim.
  vec3 H = normalize(L + V);
  float nh = max(dot(nb, H), 0.0);
  float water = (1.0 - land) * smoothstep(-0.05, 0.2, d) * ringShade * (1.0 - cover);
  float fw = 0.25 + 0.75 * pow(1.0 - zp, 4.0);
  col += vec3(1.0, 0.93, 0.8) * (pow(nh, 300.0) * 0.5 + pow(nh, 22.0) * 0.09 * fw) * water;
  col = mix(col, col * vec3(0.8, 0.9, 1.08), (1.0 - land) * (1.0 - zp) * 0.6);

  // Night side: one light per finished task.
  float night = smoothstep(0.12, -0.18, d);
  float lights = texture2D(uLights, uv).r;
  col += vec3(1.0, 0.72, 0.38) * lights * night * 1.7 * (1.0 - 0.7 * cover);

  // Clouds over everything.
  vec3 cloudCol = vec3(0.96, 0.97, 1.0) * sun * (0.06 + 0.94 * max(d, 0.0) * ringShade);
  col = mix(col, cloudCol, cover * 0.88);

  // Aurora: things you made, over both poles.
  float alat = abs(lat) * 180.0 / PI;
  float band = smoothstep(58.0, 65.0, alat) * smoothstep(80.0, 70.0, alat);
  float flick = 0.55 + 0.45 * sin(lon * 7.0 + uTime * 1.2 + sin(lon * 3.0 - uTime * 0.7) * 2.0);
  vec3 auroraCol = mix(vec3(0.35, 1.0, 0.72), vec3(0.72, 0.5, 1.0), 0.5 + 0.5 * sin(lon * 2.0 + uTime * 0.4));
  col += auroraCol * uAurora * band * flick * (0.35 + 0.9 * night);

  // Atmosphere: a blue rim, warm where day turns to night.
  float fres = pow(1.0 - zp, 3.0);
  vec3 sky = mix(vec3(0.95, 0.55, 0.3), vec3(0.45, 0.72, 1.0), smoothstep(-0.1, 0.35, d));
  col += sky * fres * (0.2 + 0.85 * uAtmo) * smoothstep(-0.25, 0.25, d);
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
    float g = exp(-(r - 1.0) * (14.0 - 6.0 * uAtmo)) * (0.18 + 0.62 * uAtmo) * lit;
    col = vec3(0.45, 0.7, 1.0) * g;
    a = g;
  }

  // Planet.
  float zp = r2 <= 1.0 ? sqrt(1.0 - r2) : -1e9;
  vec4 planet = zp > -1e8 ? shadePlanet(p, zp) : vec4(0.0);

  // Ring: where this pixel's ray crosses the ring plane.
  float zr = -1e9;
  vec4 ring = vec4(0.0);
  if (uRing > 0.0 && abs(uRingN.z) > 1e-3) {
    float z = -(uRingN.x * p.x + uRingN.y * p.y) / uRingN.z;
    vec3 q = vec3(p, z);
    float d = length(q);
    if (d > 1.32 && d < 1.66) {
      float bands = 0.55 + 0.45 * sin(d * 70.0) * sin(d * 23.0 + 1.3);
      float edge = smoothstep(1.32, 1.36, d) * smoothstep(1.66, 1.6, d);
      float alpha = uRing * edge * bands * 0.8;
      // In the planet's shadow?
      float b = dot(q, L);
      float c = dot(q, q) - 1.0;
      float shade = (b * b - c > 0.0 && -b + sqrt(b * b - c) > 0.0 && b < 0.0) ? 0.22 : 1.0;
      shade *= 0.55 + 0.45 * abs(dot(uRingN, L));
      ring = vec4(vec3(1.0, 0.83, 0.62) * shade, alpha);
      zr = z;
    }
  }

  // Moons.
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
        float lit = max(dot(mn, L), 0.0);
        float val = uMoonVal[i].x;
        vec3 base = mix(vec3(0.45, 0.48, 0.58), vec3(0.98, 0.95, 0.88), val);
        vec3 mc = base * (0.12 + 0.95 * lit);
        if (uMoonVal[i].y > 0.5) mc += vec3(1.0, 0.85, 0.55) * 0.25 * pow(1.0 - mn.z, 2.0);
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

  // A gentle filmic curve so lights and glints don't clip to flat white.
  col = col / (1.0 + col * 0.35);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`shader: ${log}`);
  }
  return s;
}

function program(gl) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
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

function texture(gl, unit, w, h, format, data) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
 * Same contract as the 2D createGlobe(): { setLayers, destroy }.
 * Returns null if WebGL can't be used on this canvas.
 */
export function createGlobeGL(canvas, { seed, tilt = 0.38, interactive = false, spin = 0.00006, maxPixels = 1100 } = {}) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  let prog;
  try {
    prog = program(gl);
  } catch (e) {
    console.warn(e);
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(prog, n);
  const u = {
    extent: U("uExtent"), aspect: U("uAspect"), rot: U("uRot"), cloudShift: U("uCloudShift"), time: U("uTime"),
    tilt: U("uTilt"), sea: U("uSea"), atmo: U("uAtmo"), aurora: U("uAurora"), cloudCover: U("uCloudCover"),
    ring: U("uRing"), light: U("uLight"), ringN: U("uRingN"), moon: U("uMoon"), moonVal: U("uMoonVal"),
  };
  gl.uniform1i(U("uColor"), 0);
  gl.uniform1i(U("uHeight"), 1);
  gl.uniform1i(U("uLights"), 2);
  gl.uniform1i(U("uClouds"), 3);

  let layers = { land: 0.2, lights: 0, aurora: 0, forest: 0.4, glow: 0, atmosphere: 0.4, clouds: 0.1, ring: 0 };
  let moons = [];
  let surface = null;
  let sea = 0.5;
  let ready = false;
  let rotA = 0;
  let cloudShift = 0;
  let dragging = null;
  let destroyed = false;
  let lost = false;

  // Light from the upper left and in front: the right of the world is night.
  const light = (() => {
    const v = [-0.62, 0.42, 0.66];
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  })();
  // The ring plane, seen just above edge-on and rolled a little.
  const ringN = rot(rot([0, 1, 0], "x", 0.2), "z", -0.32);

  function upload() {
    const painted = paint(surface, layers);
    sea = thresholdFor(surface, Math.max(0.01, Math.min(0.9, layers.land)));
    // RGB colours are already 0..255; lights are 0..1.
    texture(gl, 0, UW, UH, gl.RGB, new Uint8Array(painted.color.buffer.slice(0)));
    texture(gl, 2, TW, TH, gl.LUMINANCE, toBytes(painted.lights));
  }

  function prepare() {
    if (destroyed || lost) return;
    surface = surfaceFor(seed);
    texture(gl, 1, TW, TH, gl.LUMINANCE, toBytes(surface.height));
    texture(gl, 3, TW, TH, gl.LUMINANCE, toBytes(surface.cloud));
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
      pos.set([v[0], v[1], v[2], 0.055 + 0.035 * (m.value || 0)], i * 4);
      val.set([m.value || 0, m.done ? 1 : 0], i * 2);
    });
    gl.uniform4fv(u.moon, pos);
    gl.uniform2fv(u.moonVal, val);
  }

  function draw(t) {
    if (destroyed || lost) return;
    size();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!ready) return;
    const aspect = canvas.width / canvas.height;
    gl.uniform1f(u.extent, EXTENT);
    gl.uniform1f(u.aspect, aspect);
    gl.uniform1f(u.rot, rotA);
    gl.uniform1f(u.cloudShift, cloudShift);
    gl.uniform1f(u.time, t / 1000);
    gl.uniform1f(u.tilt, tilt);
    gl.uniform1f(u.sea, sea);
    gl.uniform1f(u.atmo, layers.atmosphere);
    gl.uniform1f(u.aurora, layers.aurora);
    gl.uniform1f(u.cloudCover, layers.clouds);
    gl.uniform1f(u.ring, layers.ring);
    gl.uniform3fv(u.light, light);
    gl.uniform3fv(u.ringN, ringN);
    moonUniforms(t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let skip = false;
  const loop = animationLoop(canvas, (t, dt) => {
    skip = !skip;
    if (skip) return; // ~30 fps is plenty for a slow spin
    if (!dragging) rotA += dt * 2 * spin * 60;
    cloudShift += dt * 2 * spin * 25;
    draw(t);
  });

  if (interactive) {
    canvas.addEventListener("pointerdown", (e) => {
      dragging = { x: e.clientX, rot: rotA };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      rotA = dragging.rot + (e.clientX - dragging.x) * 0.01;
      if (reducedMotion()) draw(performance.now());
    });
    const end = () => (dragging = null);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        rotA += e.key === "ArrowLeft" ? -0.25 : 0.25;
        draw(performance.now());
        e.preventDefault();
      }
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
      prog = program(gl);
      gl.useProgram(prog);
    } catch {
      return;
    }
    prepare();
    if (!reducedMotion()) loop.start();
  });

  let ro = null;
  if ("ResizeObserver" in window) {
    ro = new ResizeObserver(() => draw(performance.now()));
    ro.observe(canvas);
  }

  // Generating the planet takes a moment on a slow device: do it when idle.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
  idle(prepare, { timeout: 800 });
  draw(performance.now());
  if (!reducedMotion()) loop.start();

  return {
    setLayers(next, nextMoons = moons) {
      const repaint = ["land", "lights", "forest", "glow"].some((k) => next[k] !== layers[k]);
      layers = { ...layers, ...next };
      moons = nextMoons || [];
      if (repaint && ready) upload();
      draw(performance.now());
    },
    destroy() {
      destroyed = true;
      loop.destroy();
      ro?.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
    renderer: "webgl",
  };
}
