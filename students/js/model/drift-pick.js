// Which three things Drift offers today.
//
// Drift is finite on purpose: the same three for everyone with your
// interests, all day, then new ones at midnight. No feed, no "load more".
// Pure (tested in Node).
import { DAY } from "./time.js";

// Local days since 1970, so the set changes at the reader's midnight.
export function dayNumber(date) {
  const d = new Date(date);
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
}

function rotate(pool, n) {
  if (!pool.length) return null;
  return pool[((n % pool.length) + pool.length) % pool.length];
}

// Prefer items tagged with one of your interests; everything else is the
// fallback so a narrow profile still gets something every day.
function poolFor(items, interests) {
  const want = new Set((interests || []).map((s) => String(s).toLowerCase()));
  const matched = items.filter((it) => (it.tags || []).some((t) => want.has(t)));
  return matched.length >= 3 ? matched : items;
}

/**
 * @param {Date|number} date
 * @param {string[]} interests
 * @param {{facts: object[], prompts: object[], plays: object[]}} library
 */
export function pickDrift(date, interests, library) {
  const n = dayNumber(date);
  return {
    day: n,
    fact: rotate(poolFor(library.facts, interests), n),
    prompt: rotate(poolFor(library.prompts, interests), n * 7 + 3),
    play: rotate(library.plays, n),
  };
}
