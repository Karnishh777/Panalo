// Lines that fill in, eased, the first time they come into view: Plan's
// shelf and its subjects' meters. The fill itself is CSS (plan.css,
// .fill-wait and .fill-go); this only says when.
//
// Each line fills once per visit to the page. A redraw (a topic checked,
// a result added) shows the lines already full; arriving again plays them
// again. With motion reduced, or no IntersectionObserver, nothing waits:
// the lines are simply full.

import { reducedMotion } from "./motion.js";

const WAIT = "fill-wait";
const GO = "fill-go";
// Most of a line on screen before it fills, so it's seen filling.
const SEEN = { threshold: 0.6 };

export function createFills(selector) {
  const filled = new Set();
  let observer = null;

  const disconnect = () => {
    observer?.disconnect();
    observer = null;
  };

  const go = (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const line = entry.target;
      line.classList.replace(WAIT, GO);
      filled.add(line.dataset.fill);
      observer?.unobserve(line);
    }
  };

  return {
    /** A new visit: every line may fill again. */
    reset() {
      filled.clear();
    },
    /** Watch the lines under `root` that haven't filled on this visit. */
    watch(root) {
      disconnect();
      if (!root || reducedMotion() || typeof IntersectionObserver !== "function") return;
      const lines = [...root.querySelectorAll(selector)].filter((line) => line.dataset.fill && !filled.has(line.dataset.fill));
      if (!lines.length) return;
      observer = new IntersectionObserver(go, SEEN);
      for (const line of lines) {
        line.classList.add(WAIT);
        observer.observe(line);
      }
    },
    disconnect,
  };
}
