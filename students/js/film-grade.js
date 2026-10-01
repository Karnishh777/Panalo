// The film's lab: every frame of the intro passes through a colour grade
// before it reaches the screen, the way a film is finished.
//
//   scene (2D canvas) ──► texture with mipmaps
//        │                     │
//        │        bloom: the scene's blurred mip levels, added back
//        │        halation: a red glow around the brightest highlights
//        │        anamorphic streaks: highlights smeared sideways, blue
//        ▼
//   LUT grade: a 3D colour look-up table (32³, stored as 32 tiles side by
//   side). Four looks are built procedurally -- "void" (cold, crushed
//   shadows), "ignition" (white-gold, hard contrast), "nebula" (teal and
//   magenta), "gold" (warm highlights, teal shadows, the blockbuster look)
//   -- and the film crossfades between any two.
//        ▼
//   lens and print: chromatic aberration at the edges, vignette, film
//   grain, a touch of gate weave, exposure for cuts, and 2.39:1 bars.
//
// No files: the LUTs are computed here, once.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uLut;       // 1024 x 128: four 32^3 LUTs stacked
uniform float uLutA, uLutB, uLutMix;
uniform float uExposure, uBloom, uStreak, uGrain, uTime, uAberr, uVignette, uBars, uAspect, uWeave;

vec3 lut(vec3 c, float which) {
  c = clamp(c, 0.0, 1.0);
  float b = c.b * 31.0;
  float b0 = floor(b), b1 = min(b0 + 1.0, 31.0);
  float y = (which * 32.0 + 0.5 + c.g * 31.0) / 128.0;
  vec2 a = vec2((b0 * 32.0 + 0.5 + c.r * 31.0) / 1024.0, y);
  vec2 d = vec2((b1 * 32.0 + 0.5 + c.r * 31.0) / 1024.0, y);
  return mix(texture2D(uLut, a).rgb, texture2D(uLut, d).rgb, b - b0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  uv.y += uWeave * (hash(vec2(floor(uTime * 24.0), 3.0)) - 0.5) * 0.0015;
  vec2 c = uv - 0.5;

  // Chromatic aberration: the lens splits colour towards the edges.
  vec2 ca = c * uAberr * dot(c, c);
  vec3 col;
  col.r = texture2D(uScene, uv + ca).r;
  col.g = texture2D(uScene, uv).g;
  col.b = texture2D(uScene, uv - ca).b;

  // Bloom from blurred mip levels; halation in red around highlights.
  vec3 b1 = texture2D(uScene, uv, 2.5).rgb;
  vec3 b2 = texture2D(uScene, uv, 4.5).rgb;
  vec3 b3 = texture2D(uScene, uv, 6.0).rgb;
  vec3 glow = b1 * 0.35 + b2 * 0.45 + b3 * 0.5;
  vec3 hi = max(glow - 0.42, 0.0);
  col += glow * 0.18 * uBloom + hi * 1.1 * uBloom;
  col += vec3(1.0, 0.25, 0.1) * dot(hi, vec3(0.33)) * 0.6 * uBloom;

  // Anamorphic streak: bright points smeared horizontally, in blue.
  if (uStreak > 0.0) {
    vec3 s = vec3(0.0);
    for (int i = -6; i <= 6; i++) {
      float o = float(i) * 0.035;
      vec3 t = max(texture2D(uScene, vec2(uv.x + o, uv.y), 3.0).rgb - 0.55, 0.0);
      s += t * (1.0 - abs(float(i)) / 7.0);
    }
    col += vec3(0.35, 0.6, 1.0) * dot(s, vec3(0.33)) * 0.55 * uStreak;
  }

  col *= uExposure;
  // Filmic shoulder before the grade, so the LUT sees a printable image.
  col = col / (1.0 + col * 0.45);
  vec3 ga = lut(col, uLutA);
  vec3 gb = lut(col, uLutB);
  col = mix(ga, gb, uLutMix);

  // Vignette and grain, last, as on a print.
  float v = smoothstep(0.95, 0.25, length(c * vec2(uAspect * 0.75, 1.0)));
  col *= mix(1.0, v, uVignette);
  float g = hash(uv * 1000.0 + fract(uTime * 7.31) * 100.0) - 0.5;
  col += g * uGrain * (0.6 + 0.4 * (1.0 - dot(col, vec3(0.33))));

  // 2.39:1 letterbox inside whatever screen this is.
  float target = 1.0 / 2.39;
  float hFrac = min(1.0, uAspect * target);
  float bar = (1.0 - hFrac) * 0.5 * uBars;
  if (uv.y < bar || uv.y > 1.0 - bar) col = vec3(0.0);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// ---- The looks ------------------------------------------------------------------------

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Lift/gamma/gain per channel, split toning, saturation, an S-curve.
function look({ lift = [0, 0, 0], gamma = [1, 1, 1], gain = [1, 1, 1], shadows = [0, 0, 0], highs = [0, 0, 0], sat = 1, contrast = 1, pivot = 0.42, black = 0 }) {
  return (r, g, b) => {
    let c = [r, g, b].map((v, i) => {
      v = v * gain[i] + lift[i] * (1 - v);
      return Math.pow(clamp01(v), 1 / gamma[i]);
    });
    const y = luma(...c);
    const sh = clamp01(1 - y / 0.5) ** 1.5;
    const hl = clamp01((y - 0.5) / 0.5) ** 1.2;
    c = c.map((v, i) => v + shadows[i] * sh + highs[i] * hl);
    const y2 = luma(...c);
    c = c.map((v) => y2 + (v - y2) * sat);
    c = c.map((v) => {
      const x = clamp01(v);
      // A soft S around the pivot.
      const s = x < pivot ? pivot * Math.pow(x / pivot, contrast) : 1 - (1 - pivot) * Math.pow((1 - x) / (1 - pivot), contrast);
      return clamp01(black + s * (1 - black));
    });
    return c;
  };
}

const LOOKS = [
  // 0 void: cold, quiet, crushed shadows, little colour.
  look({ lift: [0.0, 0.01, 0.03], gain: [0.92, 1.0, 1.08], shadows: [-0.02, 0.01, 0.05], highs: [-0.02, 0.0, 0.03], sat: 0.7, contrast: 1.25, pivot: 0.4 }),
  // 1 ignition: white-gold, hard contrast, hot highlights.
  look({ gain: [1.12, 1.02, 0.86], shadows: [0.02, -0.01, -0.03], highs: [0.07, 0.03, -0.05], sat: 1.15, contrast: 1.4, pivot: 0.45 }),
  // 2 nebula: teal shadows, magenta-rose mids, cool highlights.
  look({ lift: [0.01, 0.015, 0.03], gain: [1.05, 0.96, 1.08], shadows: [-0.03, 0.04, 0.06], highs: [0.04, -0.01, 0.03], sat: 1.22, contrast: 1.2, pivot: 0.42 }),
  // 3 gold: teal shadows, warm skin-of-the-sun highlights.
  look({ lift: [0.0, 0.012, 0.025], gain: [1.08, 1.0, 0.9], shadows: [-0.035, 0.03, 0.05], highs: [0.06, 0.025, -0.04], sat: 1.1, contrast: 1.3, pivot: 0.43 }),
];
export const LUT = { void: 0, ignition: 1, nebula: 2, gold: 3 };

function buildLutTexture() {
  const W = 1024, H = 128, data = new Uint8Array(W * H * 4);
  LOOKS.forEach((fn, k) => {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        for (let r = 0; r < 32; r++) {
          const [R, G, B] = fn(r / 31, g / 31, b / 31);
          const o = ((k * 32 + g) * W + b * 32 + r) * 4;
          data[o] = R * 255;
          data[o + 1] = G * 255;
          data[o + 2] = B * 255;
          data[o + 3] = 255;
        }
      }
    }
  });
  return data;
}

// ---- The renderer ---------------------------------------------------------------------------

/**
 * Grade `scene` (a 2D canvas whose size is a power of two) onto `out`.
 * Returns null if WebGL isn't available; callers then show the scene raw.
 */
export function createGrader(out) {
  const gl = out.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) {
    console.warn("Film grade unavailable", e);
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ["uScene", "uLut", "uLutA", "uLutB", "uLutMix", "uExposure", "uBloom", "uStreak", "uGrain", "uTime", "uAberr", "uVignette", "uBars", "uAspect", "uWeave"]) U[n] = gl.getUniformLocation(prog, n);

  const sceneTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const lutTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1024, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildLutTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(U.uScene, 0);
  gl.uniform1i(U.uLut, 1);

  return {
    /** The scene canvas size to draw at, for a screen of w x h CSS pixels. */
    sceneSize(w, h) {
      // The nearest power of two to the screen: never far from 1:1, and
      // mipmaps (the bloom) need powers of two in WebGL 1.
      const near = (n) => Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(Math.max(2, n)))));
      return [near(w), near(h)];
    },
    /**
     * @param {HTMLCanvasElement} scene
     * @param {{a: number, b: number, mix: number, exposure: number, bloom: number, streak: number, grain: number, time: number, aberr?: number, vignette?: number, bars?: number, weave?: number}} p
     */
    render(scene, p) {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const w = Math.round(out.clientWidth * dpr), h = Math.round(out.clientHeight * dpr);
      if (out.width !== w || out.height !== h) {
        out.width = w;
        out.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform1f(U.uLutA, p.a);
      gl.uniform1f(U.uLutB, p.b);
      gl.uniform1f(U.uLutMix, p.mix);
      gl.uniform1f(U.uExposure, p.exposure);
      gl.uniform1f(U.uBloom, p.bloom);
      gl.uniform1f(U.uStreak, p.streak);
      gl.uniform1f(U.uGrain, p.grain);
      gl.uniform1f(U.uTime, p.time);
      gl.uniform1f(U.uAberr, p.aberr ?? 0.012);
      gl.uniform1f(U.uVignette, p.vignette ?? 0.85);
      gl.uniform1f(U.uBars, p.bars ?? 1);
      gl.uniform1f(U.uAspect, out.clientWidth / Math.max(1, out.clientHeight));
      gl.uniform1f(U.uWeave, p.weave ?? 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
