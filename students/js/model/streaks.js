// The comet's streaks (v0.3): one per subject (up to nine), lit when that
// subject is ready for the exam hall. Pure (tested in Node).

export const MAX_STREAKS = 9;

/** Streaks and lit streaks for a student, from each subject's readiness
 * (0..1): lit when it reaches `ready`. */
export function streaksFor(readiness, { ready = 0.75 } = {}) {
  const list = (readiness || []).slice(0, MAX_STREAKS);
  return { streaks: Math.max(1, list.length), lit: list.filter((r) => r >= ready).length };
}
