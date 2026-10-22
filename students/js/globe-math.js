// Where a place on Earth is on a globe, the same way both renderers draw
// it (world-gl.js, world-render.js): longitude turns with the planet's spin,
// then the axial tilt tips it towards or away from you.
//
// Pure (tests/students-model.test.mjs).

const RAD = Math.PI / 180;

/**
 * A latitude/longitude (degrees) on a unit globe, seen from the front:
 * x right, y up, z towards you (z < 0 is round the back).
 * @param {number} rot  the planet's spin (radians)
 * @param {number} tilt the axial tilt towards you (radians)
 */
export function globePoint(lat, lon, rot, tilt) {
  const phi = lat * RAD;
  const a = lon * RAD - rot;
  const fx = Math.cos(phi) * Math.sin(a);
  const fy = Math.sin(phi);
  const fz = Math.cos(phi) * Math.cos(a);
  const c = Math.cos(tilt), s = Math.sin(tilt);
  return { x: fx, y: fy * c - fz * s, z: fy * s + fz * c };
}

/** The spin that turns a longitude to face you, nearest to `from`. */
export function spinToFace(lon, from = 0) {
  const target = lon * RAD;
  const d = Math.atan2(Math.sin(target - from), Math.cos(target - from));
  return from + d;
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const p1 = a.lat * RAD, p2 = b.lat * RAD;
  const dp = p2 - p1, dl = (b.lon - a.lon) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
