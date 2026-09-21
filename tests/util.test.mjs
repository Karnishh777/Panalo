// Tests for the pure helpers in src/util.js. No DOM is touched at import
// time, so this runs in plain Node.
import { mapLimited } from "../src/util.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

async function main() {
  // ---- mapLimited -----------------------------------------------------
  // Order must follow the INPUT, not completion. Workers finish out of
  // order by design, so a naive push() would scramble the sidebar.
  const delays = [40, 5, 30, 1, 20, 10];
  const ordered = await mapLimited(delays, 2, async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    return i;
  });
  ok("preserves input order regardless of completion order",
     JSON.stringify(ordered) === JSON.stringify([0, 1, 2, 3, 4, 5]));

  // Never exceed the concurrency cap — the whole point of the helper.
  let inFlight = 0;
  let peak = 0;
  await mapLimited(Array.from({ length: 25 }, (_, i) => i), 4, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
  });
  ok("never exceeds the concurrency limit", peak <= 4);
  ok("actually runs work in parallel up to the limit", peak > 1);

  // Every item must be visited exactly once: a chat skipped here is a chat
  // with no preview and no unread badge.
  const seen = new Set();
  const items = Array.from({ length: 50 }, (_, i) => `c${i}`);
  await mapLimited(items, 7, async (id) => seen.add(id));
  ok("visits every item exactly once", seen.size === 50);

  // Degenerate inputs must not hang or throw.
  ok("empty input returns empty", (await mapLimited([], 5, async () => 1)).length === 0);
  ok("limit larger than input is fine",
     JSON.stringify(await mapLimited([1, 2], 99, async (n) => n * 2)) === JSON.stringify([2, 4]));
  ok("limit of zero still makes progress rather than hanging",
     JSON.stringify(await mapLimited([1, 2, 3], 0, async (n) => n)) === JSON.stringify([1, 2, 3]));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exitCode = 1;
});
