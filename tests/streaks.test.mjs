// The comet's streaks: one per subject, lit when the subject is ready.
import assert from "node:assert/strict";
import { streaksFor, MAX_STREAKS } from "../students/js/model/streaks.js";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
};

t("one streak per subject, lit when ready", () => {
  assert.deepEqual(streaksFor([0.9, 0.2, 0.8, 0.5]), { streaks: 4, lit: 2 });
});
t("no subjects yet: one dim streak", () => {
  assert.deepEqual(streaksFor([]), { streaks: 1, lit: 0 });
  assert.deepEqual(streaksFor(null), { streaks: 1, lit: 0 });
});
t("at most nine", () => {
  assert.equal(streaksFor(Array(12).fill(1)).streaks, MAX_STREAKS);
  assert.equal(streaksFor(Array(12).fill(1)).lit, MAX_STREAKS);
});
t("the bar can be set", () => {
  assert.equal(streaksFor([0.6, 0.7], { ready: 0.6 }).lit, 2);
});

console.log(`streaks: ${passed} passed`);
