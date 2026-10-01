// How the worlds are lit, chosen by the person and remembered on this
// device: where the sun is (angle around, height above), how bright the
// night side is, or "live" -- the sun follows your clock, so your world is
// in daylight at noon and shows its city lights at midnight.
//
// Every globe on the page listens for changes, so moving the sun on the
// landing page or in World moves it everywhere.
const KEY = "panalo.students.light";
const EVENT = "panalo:light";

export const PRESETS = {
  day: { azimuth: -14, elevation: 16 },
  dusk: { azimuth: -43, elevation: 25 },
  night: { azimuth: 155, elevation: 12 },
};
export const DEFAULT_LIGHT = { mode: "dusk", ...PRESETS.dusk, night: 0.12 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v)));

export function getLight() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    /* storage unavailable: defaults */
  }
  const l = { ...DEFAULT_LIGHT, ...saved };
  return {
    mode: ["day", "dusk", "night", "live", "custom"].includes(l.mode) ? l.mode : "dusk",
    azimuth: clamp(l.azimuth, -180, 180) || 0,
    elevation: clamp(l.elevation, -60, 60) || 0,
    night: clamp(l.night, 0, 1) || 0,
  };
}

export function setLight(patch) {
  let next = { ...getLight(), ...patch };
  // A preset sets the sun; moving the sun by hand makes it "custom" (only
  // the height can change while it follows the clock).
  if (patch.mode && PRESETS[patch.mode]) next = { ...next, ...PRESETS[patch.mode] };
  else if (!patch.mode && (patch.azimuth !== undefined || (patch.elevation !== undefined && next.mode !== "live"))) next.mode = "custom";
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: this page only */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

export function onLight(fn) {
  const h = (e) => fn(e.detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

// "Live": noon faces you, midnight is behind the world.
export function liveAzimuth(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  let a = ((h - 12) / 24) * 360 - 20;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/** The direction towards the sun in view space (x right, y up, z towards you). */
export function lightVector(l = getLight()) {
  const az = ((l.mode === "live" ? liveAzimuth() : l.azimuth) * Math.PI) / 180;
  const el = (l.elevation * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}
