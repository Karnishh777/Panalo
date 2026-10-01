// Generated study sound. No audio files: every soundscape is synthesised
// with the Web Audio API, so it costs nothing to download, loops forever
// without a seam, and works offline once the app has loaded.
//
//   hum      two low detuned sines, slowly breathing — "deep space"
//   rain     filtered noise with a soft, uneven patter
//   brown    brown noise, the low steady one people use to concentrate
//   orbit    a slow, quiet chord that drifts in and out
let ctx = null;
let master = null;
let nodes = [];
let current = "off";
let currentOut = null;

export const SOUNDS = [
  { id: "off", label: "Silence" },
  { id: "hum", label: "Deep space" },
  { id: "rain", label: "Rain" },
  { id: "brown", label: "Brown noise" },
  { id: "orbit", label: "Slow orbit" },
];

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function noiseBuffer(kind) {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === "brown") {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    } else d[i] = white * 0.5;
  }
  return buf;
}

function track(n) {
  nodes.push(n);
  return n;
}

function lfo(rate, depth, target) {
  const o = track(ctx.createOscillator());
  const g = track(ctx.createGain());
  o.frequency.value = rate;
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start();
}

function build(kind) {
  const out = track(ctx.createGain());
  out.gain.value = 0;
  out.connect(master);
  if (kind === "brown" || kind === "rain") {
    const src = track(ctx.createBufferSource());
    src.buffer = noiseBuffer(kind === "brown" ? "brown" : "white");
    src.loop = true;
    const f = track(ctx.createBiquadFilter());
    if (kind === "brown") {
      f.type = "lowpass";
      f.frequency.value = 520;
    } else {
      f.type = "bandpass";
      f.frequency.value = 1400;
      f.Q.value = 0.45;
      const body = track(ctx.createGain());
      body.gain.value = 0.7;
      lfo(0.13, 0.18, body.gain); // the patter comes and goes
      src.connect(f).connect(body).connect(out);
      src.start();
      return out;
    }
    src.connect(f).connect(out);
    src.start();
  } else if (kind === "hum") {
    const f = track(ctx.createBiquadFilter());
    f.type = "lowpass";
    f.frequency.value = 300;
    f.connect(out);
    for (const [freq, detune] of [[55, -4], [55, 5], [82.41, 0], [110, 2]]) {
      const o = track(ctx.createOscillator());
      const g = track(ctx.createGain());
      o.type = "sine";
      o.frequency.value = freq;
      o.detune.value = detune;
      g.gain.value = freq > 100 ? 0.08 : 0.22;
      lfo(0.05 + Math.random() * 0.05, 0.06, g.gain);
      o.connect(g).connect(f);
      o.start();
    }
  } else if (kind === "orbit") {
    const f = track(ctx.createBiquadFilter());
    f.type = "lowpass";
    f.frequency.value = 1200;
    f.connect(out);
    for (const freq of [220, 261.63, 329.63, 392, 493.88]) {
      const o = track(ctx.createOscillator());
      const g = track(ctx.createGain());
      o.type = "triangle";
      o.frequency.value = freq;
      g.gain.value = 0.03;
      lfo(0.03 + Math.random() * 0.06, 0.028, g.gain);
      o.connect(g).connect(f);
      o.start();
    }
  }
  return out;
}

export function playAmbient(kind) {
  if (kind === current) return current;
  const old = nodes;
  const oldOut = currentOut;
  nodes = [];
  currentOut = null;
  if (ctx && old.length) {
    const t = ctx.currentTime;
    if (oldOut) oldOut.gain.setTargetAtTime(0, t, 0.4);
    setTimeout(() => old.forEach((n) => {
      try {
        n.stop?.();
        n.disconnect();
      } catch {}
    }), 2000);
  }
  current = kind;
  if (kind === "off") return current;
  if (!audio()) return (current = "off");
  const out = build(kind);
  currentOut = out;
  out.gain.setTargetAtTime(1, ctx.currentTime, 0.8); // fade in, never start loud
  return current;
}

export function setVolume(v) {
  if (!audio()) return;
  master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.1);
}

export function currentSound() {
  return current;
}

// A soft two-note bell for the end of a session.
export function chime() {
  if (!audio()) return;
  const t = ctx.currentTime;
  for (const [freq, delay] of [[784, 0], [1174.66, 0.18]]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t + delay);
    g.gain.linearRampToValueAtTime(0.25, t + delay + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 2.2);
    o.connect(g).connect(master);
    o.start(t + delay);
    o.stop(t + delay + 2.3);
  }
}
