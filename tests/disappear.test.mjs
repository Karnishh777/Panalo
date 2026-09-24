// Tests for the disappearing-messages choices and notices. Pure, plain Node.
// The rule itself is tested against Postgres in migrations.test.mjs.
import {
  TIMERS, normalizeTimer, timerLabel, timerMarker, parseTimerMarker,
  describeTimerChange, describeTimerMarker, msUntilExpiry, isExpired, MAX_TIMER_DELAY_MS,
} from "../src/disappear.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

// ---- the choices ---------------------------------------------------------------
ok("offers off, 24 hours, 7 days, 90 days",
   TIMERS.map((t) => t.label).join(",") === "Off,24 hours,7 days,90 days");
ok("the values match the database constraint",
   TIMERS.map((t) => t.value).join(",") === ",1 day,7 days,90 days");

// Postgres spells intervals according to IntervalStyle.
ok("postgres style", normalizeTimer("7 days") === "7 days" && normalizeTimer("1 day") === "1 day");
ok("postgres style for 24 hours", normalizeTimer("24:00:00") === "1 day");
ok("ISO 8601 style", normalizeTimer("P90D") === "90 days");
ok("off", normalizeTimer(null) === null && normalizeTimer("") === null);
ok("an unexpected value is treated as off", normalizeTimer("3 days") === null && normalizeTimer("banana") === null);
ok("labels", timerLabel("1 day") === "24 hours" && timerLabel(null) === "Off" && timerLabel("P7D") === "7 days");

// ---- the notice in the chat ------------------------------------------------------
ok("marker round-trips a timer", parseTimerMarker(timerMarker("7 days"))?.value === "7 days");
ok("marker round-trips off", parseTimerMarker(timerMarker(null))?.value === null);
ok("ordinary text is not a marker", parseTimerMarker("[[timer:5 minutes]]") === null && parseTimerMarker("hi") === null);
ok("the notice names who changed it",
   describeTimerChange("7 days", "Ada") === "Ada turned on disappearing messages. New messages will disappear 7 days after they're sent.");
ok("the notice for turning it off", describeTimerChange(null, "You") === "You turned off disappearing messages.");
ok("chat-list preview", describeTimerMarker(timerMarker("1 day")) === "⏱ Disappearing messages: 24 hours");
ok("chat-list preview leaves other text alone", describeTimerMarker("hello") === "hello");

// ---- removing it from the screen on time ------------------------------------------
const now = Date.parse("2026-09-24T12:00:00Z");
ok("no expiry, no timer", msUntilExpiry(null, now) === null);
ok("time left", msUntilExpiry("2026-09-24T12:00:05Z", now) === 5000);
ok("already past is zero, not negative", msUntilExpiry("2026-09-24T11:00:00Z", now) === 0);
ok("too far away for setTimeout is left alone",
   msUntilExpiry(new Date(now + MAX_TIMER_DELAY_MS + 1).toISOString(), now) === null);
ok("garbage is left alone", msUntilExpiry("not a date", now) === null);
ok("expired", isExpired("2026-09-24T11:59:59Z", now) && !isExpired("2026-09-24T12:00:01Z", now));
ok("no expiry never expires", !isExpired(null, now));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
