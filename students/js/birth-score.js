// The intro's sound: a small trailer score, mixed live with Web Audio.
//
//   music bus ─┐                         ┌─► dry ─────────┐
//   sfx bus  ──┼─► (ducks under the VO) ─┤                ├─► master ─► glue compressor ─► limiter ─► out
//              │                         └─► reverb send ─┘   (a 4 s hall made from shaped noise)
//
// Cues: a sub drone that breathes, a heartbeat, a riser that cuts to
// silence, the hit (a distorted brass-like braam, a boom, a crack, a sub
// drop), a whoosh, pads and a shimmer, and a resolve. Everything is
// synthesized here -- there are no audio files to download.
//
// The voice-over uses the best English voice this device has (speech
// synthesis); the lines are fixed text, never anything you wrote. Captions
// always show. Sound is on unless turned off; the choice is remembered.
import { getPrefs, setPrefs } from "./ui.js";

const LEVEL = 0.8;

export function soundWanted() {
  return getPrefs().introSound !== false;
}

export function setSoundWanted(on) {
  setPrefs({ introSound: !!on });
}

function impulse(ctx, seconds = 4, decay = 3.2) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Darker as it decays, like air absorbing the highs.
      const k = 0.35 + 0.6 * t;
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
    }
  }
  return ir;
}

function distortion(ctx, amount = 18) {
  const ws = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  ws.curve = curve;
  ws.oversample = "2x";
  return ws;
}

export function createScore() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  let ctx;
  try {
    ctx = new AC({ latencyHint: "playback" });
  } catch {
    return null;
  }
  let muted = !soundWanted();

  // ---- the mix
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : LEVEL;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.ratio.value = 3;
  glue.attack.value = 0.02;
  glue.release.value = 0.3;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  master.connect(glue).connect(limiter).connect(ctx.destination);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx);
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.9;
  verb.connect(verbOut).connect(master);

  const music = ctx.createGain(); // ducked under the voice
  const sfx = ctx.createGain();
  for (const bus of [music, sfx]) {
    bus.connect(master);
  }
  const send = (node, amount) => {
    const g = ctx.createGain();
    g.gain.value = amount;
    node.connect(g).connect(verb);
    return node;
  };

  const noise = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = noise.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  const live = new Set();
  const keep = (src) => {
    live.add(src);
    src.onended = () => live.delete(src);
    return src;
  };
  const ready = () => !muted && ctx.state === "running";
  const now = () => ctx.currentTime + 0.01;
  const osc = (type, f) => {
    const o = keep(ctx.createOscillator());
    o.type = type;
    o.frequency.value = f;
    return o;
  };
  const noiseSrc = () => {
    const s = keep(ctx.createBufferSource());
    s.buffer = noise;
    s.loop = true;
    return s;
  };
  const env = (t, { a = 0.01, peak = 1, hold = 0, r = 1 } = {}) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
    return g;
  };
  const stopAt = (nodes, t) => nodes.forEach((n) => (n.start(now()), n.stop(t)));

  return {
    resume() {
      if (ctx.state !== "running") ctx.resume?.().catch(() => {});
    },
    get muted() {
      return muted;
    },
    setMuted(m) {
      muted = m;
      if (!m) this.resume();
      master.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.08);
      if (m) window.speechSynthesis?.cancel();
    },

    // A sub drone that breathes: low fifths, opening slowly.
    drone(dur = 8) {
      if (!ready()) return;
      const t = now();
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(90, t);
      lp.frequency.exponentialRampToValueAtTime(420, t + dur);
      const g = env(t, { a: dur * 0.5, peak: 0.32, hold: dur * 0.3, r: dur * 0.3 });
      const lfo = osc("sine", 0.18);
      const lg = ctx.createGain();
      lg.gain.value = 0.12;
      lfo.connect(lg).connect(g.gain);
      send(lp.connect(g), 0.3).connect(music);
      const parts = [osc("sawtooth", 36.7), osc("sawtooth", 36.9), osc("sawtooth", 55.1), osc("sine", 36.7)];
      parts.forEach((o) => o.connect(lp));
      stopAt([...parts, lfo], t + dur + 0.2);
    },

    // Lub-dub, lub-dub: very low, felt more than heard.
    heartbeat(count = 4, every = 0.95) {
      if (!ready()) return;
      for (let i = 0; i < count; i++) {
        for (const [d, peak] of [[0, 0.55], [0.27, 0.35]]) {
          const t = now() + i * every + d;
          const o = keep(ctx.createOscillator());
          o.frequency.setValueAtTime(62, t);
          o.frequency.exponentialRampToValueAtTime(36, t + 0.2);
          const g = env(t, { a: 0.008, peak: peak * (0.6 + 0.4 * (i / count)), r: 0.25 });
          o.connect(g).connect(sfx);
          o.start(t);
          o.stop(t + 0.35);
        }
      }
    },

    // Tension: noise and a tone climbing together, faster and faster, then
    // nothing at all.
    riser(dur = 3) {
      if (!ready()) return;
      const t = now(), end = t + dur;
      const n = noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 5;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(7000, end);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, end - 0.02);
      g.gain.linearRampToValueAtTime(0, end);
      const tone = osc("sawtooth", 110);
      tone.frequency.exponentialRampToValueAtTime(880, end);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t);
      tg.gain.exponentialRampToValueAtTime(0.08, end - 0.02);
      tg.gain.linearRampToValueAtTime(0, end);
      const trem = osc("sine", 4);
      trem.frequency.exponentialRampToValueAtTime(22, end);
      const tdepth = ctx.createGain();
      tdepth.gain.value = 0.5;
      const tremGain = ctx.createGain();
      tremGain.gain.value = 0.6;
      trem.connect(tdepth).connect(tremGain.gain);
      n.connect(bp).connect(g).connect(tremGain);
      tone.connect(tg).connect(tremGain);
      send(tremGain, 0.35).connect(sfx);
      stopAt([n, tone, trem], end + 0.05);
    },

    // The hit: braam + boom + crack + sub drop, into a big hall.
    impact() {
      if (!ready()) return;
      const t = now();
      // Braam: low brass-like stack, distorted, the filter closing over seconds.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(3200, t);
      lp.frequency.exponentialRampToValueAtTime(180, t + 4.5);
      const drive = distortion(ctx, 12);
      const bg = env(t, { a: 0.03, peak: 0.42, hold: 0.6, r: 4.2 });
      const notes = [41.2, 41.5, 61.7, 82.4, 82.0, 123.5];
      const stack = notes.map((f) => osc("sawtooth", f));
      stack.forEach((o) => o.connect(drive));
      send(drive.connect(lp).connect(bg), 0.55).connect(music);
      // Boom: noise falling through a closing filter.
      const n = noiseSrc();
      const nl = ctx.createBiquadFilter();
      nl.type = "lowpass";
      nl.frequency.setValueAtTime(6000, t);
      nl.frequency.exponentialRampToValueAtTime(50, t + 3);
      send(n.connect(nl).connect(env(t, { a: 0.005, peak: 0.9, r: 3.4 })), 0.5).connect(sfx);
      // Crack: a hard transient on top.
      const c = noiseSrc();
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2500;
      send(c.connect(hp).connect(env(t, { a: 0.001, peak: 0.5, r: 0.18 })), 0.7).connect(sfx);
      // Sub drop.
      const sub = osc("sine", 90);
      sub.frequency.exponentialRampToValueAtTime(24, t + 2.6);
      sub.connect(env(t, { a: 0.006, peak: 0.95, r: 3 })).connect(sfx);
      stopAt([...stack, n, c, sub], t + 6);
    },

    // Air moving past the lens, panning across.
    whoosh(dur = 1.6) {
      if (!ready()) return;
      const t = now();
      const n = noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(3500, t + dur * 0.6);
      bp.frequency.exponentialRampToValueAtTime(600, t + dur);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) {
        pan.pan.setValueAtTime(-0.8, t);
        pan.pan.linearRampToValueAtTime(0.8, t + dur);
      }
      const g = env(t, { a: dur * 0.55, peak: 0.28, r: dur * 0.45 });
      const chain = n.connect(bp).connect(g);
      send(pan ? chain.connect(pan) : chain, 0.4).connect(sfx);
      stopAt([n], t + dur + 0.1);
    },

    // A slow chord: three detuned saws a note, softened, with a long tail.
    pad(freqs = [146.8, 220, 277.2, 329.6, 440], dur = 8, level = 0.08) {
      if (!ready()) return;
      const t = now();
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.exponentialRampToValueAtTime(1800, t + dur * 0.6);
      const g = env(t, { a: dur * 0.4, peak: level, hold: dur * 0.3, r: dur * 0.3 });
      send(lp.connect(g), 0.8).connect(music);
      const parts = [];
      for (const f of freqs) for (const d of [-0.006, 0, 0.007]) parts.push(osc("sawtooth", f * (1 + d)));
      parts.forEach((o) => o.connect(lp));
      stopAt(parts, t + dur + 0.2);
    },

    // High bell partials, mostly reverb.
    shimmer(dur = 6) {
      if (!ready()) return;
      [880, 1318.5, 1760, 2637].forEach((f, i) => {
        const t = now() + i * 0.35;
        const o = osc("sine", f);
        const g = env(t, { a: 0.6, peak: 0.03, r: dur });
        const out = ctx.createGain();
        out.gain.value = 0.25;
        o.connect(g);
        g.connect(out).connect(music);
        g.connect(verb);
        o.start(t);
        o.stop(t + dur + 1);
      });
    },

    // The ending: a warm major chord over a low note, and the shimmer.
    resolve() {
      if (!ready()) return;
      this.pad([73.4, 146.8, 220, 293.7, 370, 440, 554.4], 9, 0.1);
      this.shimmer(7);
      const t = now();
      const o = osc("sine", 73.4);
      o.connect(env(t, { a: 1.2, peak: 0.3, r: 6 })).connect(music);
      o.start(t);
      o.stop(t + 8);
    },

    // Music steps back while the voice speaks.
    duck(on) {
      music.gain.setTargetAtTime(on ? 0.35 : 1, ctx.currentTime, on ? 0.08 : 0.5);
      sfx.gain.setTargetAtTime(on ? 0.6 : 1, ctx.currentTime, on ? 0.08 : 0.5);
    },

    close() {
      window.speechSynthesis?.cancel();
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(0, t, 0.25);
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
      }, 1200);
    },
  };
}

// ---- The voice-over ---------------------------------------------------------------------------

let chosen = null;
function pickVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
  if (!voices.length) return null;
  const score = (v) => {
    let s = 0;
    if (/natural|neural|premium|enhanced|siri/i.test(v.name)) s += 6;
    if (/daniel|arthur|oliver|ryan|guy|andrew|brian|aaron|alex|george|google uk english male/i.test(v.name)) s += 3;
    if (/en-gb/i.test(v.lang)) s += 1;
    if (v.localService) s += 1;
    if (/compact|eloquence|novelty|whisper|bad news|bells|boing|bubbles|cellos|zarvox|trinoids|albert|jester|organ|superstar/i.test(v.name)) s -= 10;
    return s;
  };
  return voices.sort((a, b) => score(b) - score(a))[0];
}

/** Ready the voice list early; some browsers load it asynchronously. */
export function warmVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  chosen = pickVoice();
  if (!chosen) synth.addEventListener?.("voiceschanged", () => (chosen = pickVoice()), { once: true });
}

/**
 * Speak one line in a low, unhurried voice. Resolves when it ends (or at
 * once if there is no speech synthesis or the sound is off).
 */
export function speak(line, { score } = {}) {
  const synth = window.speechSynthesis;
  if (!synth || !line || score?.muted || !soundWanted()) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(line);
    chosen ||= pickVoice();
    if (chosen) u.voice = chosen;
    u.lang = chosen?.lang || "en-GB";
    u.rate = 0.84;
    u.pitch = 0.7;
    u.volume = 1;
    const done = () => {
      score?.duck(false);
      resolve();
    };
    u.onstart = () => score?.duck(true);
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
    setTimeout(done, 9000); // never hang on a voice that never ends
  });
}
