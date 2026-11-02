// Pan's tails: one per subject, the middle ones light first.
import assert from "node:assert/strict";
import { fan, tailsFor, POSES, MAX_TAILS } from "../students/js/model/pan-tails.js";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log("  ok", name);
};

t("six tails, three lit", () => {
  const f = fan("idle", 6, 3);
  assert.equal(f.length, 6);
  assert.equal(f.filter((x) => x.lit).length, 3);
});

t("the fan is even about the middle and never wider than the pose allows", () => {
  const a = fan("idle", 9, 0).map((x) => x.angle).sort((p, q) => p - q);
  assert.equal(a[0], -a[a.length - 1]);
  assert.ok(Math.abs(a[0]) <= POSES.idle.max);
});

t("the middle tails light first and are drawn last, on top", () => {
  const f = fan("idle", 5, 1);
  const lit = f.find((x) => x.lit);
  assert.equal(lit.angle, 0);
  assert.equal(f[f.length - 1], lit);
});

t("left-hand tails are mirrored so they curl outward", () => {
  for (const x of fan("idle", 6, 0)) assert.equal(x.mirror, x.angle < 0);
});

t("counts are kept in range", () => {
  assert.equal(fan("idle", 20, 20).length, MAX_TAILS);
  assert.equal(fan("idle", 0, 5).length, 1);
  assert.equal(fan("idle", 3, 7).filter((x) => x.lit).length, 3);
});

t("asleep, the tails are part of the picture", () => {
  assert.deepEqual(fan("sleep", 6, 3), []);
});

t("a first-week Pan fans backwards, to one side", () => {
  for (const x of fan("early", 2, 0)) assert.ok(x.angle < 0);
});

t("tails for a student: one per subject, lit when ready", () => {
  assert.deepEqual(tailsFor([0.9, 0.2, 0.8, 0.5]), { tails: 4, lit: 2 });
  assert.deepEqual(tailsFor([]), { tails: 1, lit: 0 });
  assert.equal(tailsFor(Array(12).fill(1)).tails, MAX_TAILS);
});

console.log(`pan-tails: ${passed} passed`);
