// The intro's sound: synthesized on the spot with Web Audio, no files.
//
// A hum that rises under the countdown, a tick per number, the bang (a
// noise burst and a falling sub tone), the rush of the warp, a soft chord
// as the nebula opens, and a two-note chime when the world is found.
// Sound is on unless the person turned it off; the choice is remembered on
// this device. If the browser has no Web Audio, or won't start it, the
// intro simply plays in silence.
import { getPrefs, setPrefs } from "./ui.js";

const LEVEL = 0.45;

export function soundWanted() {
  return getPrefs().introSound !== false;
}

export function setSoundWanted(on) {
  setPrefs({ introSound: !!on });
}

export function createScore() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  let ctx;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  let muted = !soundWanted();
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : LEVEL;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const live = new Set();
  const keep = (src) => {
    live.add(src);
    src.onended = () => live.delete(src);
    return src;
  };
  // Nothing is scheduled while muted or suspended, so nothing piles up to
  // play all at once later.
  const ready = () => !muted && ctx.state === "running";
  const env = (g, t, peak, attack, release) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  };
  const noiseSource = () => {
    const s = keep(ctx.createBufferSource());
    s.buffer = noise;
    s.loop = true;
    return s;
  };

  return {
    // Browsers start audio only after the person has interacted with the
    // page; signing in counts, and so does pressing the sound button.
    resume() {
      if (ctx.state !== "running") ctx.resume?.().catch(() => {});
    },
    get muted() {
      return muted;
    },
    setMuted(m) {
      muted = m;
      if (!m) this.resume();
      master.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.06);
    },
    drone(dur) {
      if (!ready()) return;
      const t = ctx.currentTime;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(110, t);
      lp.frequency.exponentialRampToValueAtTime(1100, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28, t + dur * 0.92);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
      lp.connect(g).connect(master);
      for (const [type, f0, f1] of [["sawtooth", 38, 96], ["sine", 38.6, 97.5], ["triangle", 76, 190]]) {
        const o = keep(ctx.createOscillator());
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    },
    tick(high = false) {
      if (!ready()) return;
      const t = ctx.currentTime;
      const o = keep(ctx.createOscillator());
      o.frequency.value = high ? 1320 : 880;
      const g = ctx.createGain();
      env(g, t, 0.16, 0.004, 0.12);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.2);
    },
    boom() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const n = noiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(5200, t);
      lp.frequency.exponentialRampToValueAtTime(70, t + 2.8);
      const g = ctx.createGain();
      env(g, t, 0.9, 0.012, 3.2);
      n.connect(lp).connect(g).connect(master);
      n.start(t);
      n.stop(t + 3.4);
      const sub = keep(ctx.createOscillator());
      sub.frequency.setValueAtTime(110, t);
      sub.frequency.exponentialRampToValueAtTime(26, t + 2.2);
      const sg = ctx.createGain();
      env(sg, t, 0.85, 0.01, 2.6);
      sub.connect(sg).connect(master);
      sub.start(t);
      sub.stop(t + 2.8);
    },
    whoosh(dur) {
      if (!ready()) return;
      const t = ctx.currentTime;
      const n = noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.exponentialRampToValueAtTime(260, t + dur);
      const g = ctx.createGain();
      env(g, t, 0.3, 0.25, dur);
      n.connect(bp).connect(g).connect(master);
      n.start(t);
      n.stop(t + dur + 0.4);
    },
    shimmer(dur) {
      if (!ready()) return;
      const t = ctx.currentTime;
      [220, 277.18, 329.63, 440, 554.37].forEach((f, i) => {
        const o = keep(ctx.createOscillator());
        o.type = "sine";
        o.frequency.value = f * (1 + (i % 2 ? 0.0025 : -0.002));
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05 - i * 0.006, t + dur * 0.45 + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + dur + 0.1);
      });
    },
    chime() {
      if (!ready()) return;
      const t = ctx.currentTime;
      [[1046.5, 0], [1568, 0.14]].forEach(([f, d]) => {
        const o = keep(ctx.createOscillator());
        o.type = "triangle";
        o.frequency.value = f;
        const g = ctx.createGain();
        env(g, t + d, 0.12, 0.006, 0.9);
        o.connect(g).connect(master);
        o.start(t + d);
        o.stop(t + d + 1);
      });
    },
    // Fade out, then let go of the audio device.
    close() {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(0, t, 0.12);
      setTimeout(() => {
        for (const s of live) {
          try {
            s.stop();
          } catch {
            /* already stopped */
          }
        }
        live.clear();
        ctx.close?.().catch(() => {});
      }, 600);
    },
  };
}
