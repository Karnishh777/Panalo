// Pan's tails (v0.3): one per subject, lit when that subject is ready for
// the exam hall. Pan is drawn from parts -- a body per pose and one tail,
// lit or dim -- and this works out where each tail goes. Pure (tested in Node).

/** Where the tails meet the body in each pose (percent of the frame), how
 * long they are (share of the frame's width), which way the fan points and
 * how wide it may open. Asleep, the tails are part of the picture. */
export const POSES = {
  idle: { x: 50, y: 64, len: 0.62, base: 0, max: 84 },
  think: { x: 49, y: 64, len: 0.62, base: 0, max: 84 },
  cheer: { x: 49, y: 64, len: 0.62, base: 0, max: 84 },
  early: { x: 19, y: 75, len: 0.5, base: -50, max: 24 },
  sleep: null,
};

export const MAX_TAILS = 9;

/** The frame every pose is drawn in: 760 by 1000. */
export const ASPECT = 1000 / 760;

/**
 * The tails to draw, back to front: each with its angle (degrees from
 * straight up), whether it is lit, and whether it is mirrored so it curls
 * outward. The ones nearest the middle light first.
 */
export function fan(pose, tails, lit) {
  const c = POSES[pose];
  if (!c) return [];
  const n = Math.max(1, Math.min(MAX_TAILS, Math.round(Number(tails)) || 1));
  const k = Math.max(0, Math.min(n, Math.round(Number(lit)) || 0));
  const spread = Math.min(c.max, 17 * (n - 1));
  const angles = Array.from({ length: n }, (_, i) => c.base + (n > 1 ? -spread + (2 * spread * i) / (n - 1) : 0));
  const byCentre = angles.map((_, i) => i).sort((p, q) => Math.abs(angles[p] - c.base) - Math.abs(angles[q] - c.base) || p - q);
  const on = new Set(byCentre.slice(0, k));
  return byCentre
    .slice()
    .reverse()
    .map((i) => ({ angle: Math.round(angles[i] * 10) / 10, lit: on.has(i), mirror: angles[i] < c.base }));
}

/** Tails and lit tails for a student: one per subject (up to nine), lit
 * when its readiness reaches `ready` (0..1). */
export function tailsFor(readiness, { ready = 0.75 } = {}) {
  const list = (readiness || []).slice(0, MAX_TAILS);
  return { tails: Math.max(1, list.length), lit: list.filter((r) => r >= ready).length };
}
