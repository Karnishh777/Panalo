// Tests for how an unreadable chat explains itself. Pure, plain Node.
//
// Every unreadable message used to say "unlock to read", including for people
// who were unlocked and had nothing to unlock.
import {
  KEY_PROBLEM, lockedPreview, lockedExplanation, canAskForKey,
  KEY_REQUEST_MARKER, isKeyRequest, describeKeyRequest,
} from "../src/keystatus.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

ok("only a locked device is told to unlock", lockedPreview(KEY_PROBLEM.LOCKED).includes("unlock"));
ok("a missing key is not told to unlock", !lockedPreview(KEY_PROBLEM.MISSING).includes("unlock"));
ok("a stale key is not told to unlock", !lockedPreview(KEY_PROBLEM.STALE).includes("unlock"));
ok("the three previews are different",
   new Set(Object.values(KEY_PROBLEM).map(lockedPreview)).size === 3);
ok("an unknown problem falls back to missing", lockedPreview("?") === lockedPreview(KEY_PROBLEM.MISSING));

ok("the explanation for a stale key mentions the password reset", lockedExplanation(KEY_PROBLEM.STALE).includes("password reset"));
ok("the explanations say someone can share the key",
   lockedExplanation(KEY_PROBLEM.MISSING).includes("share") && lockedExplanation(KEY_PROBLEM.STALE).includes("share"));

ok("asking helps when the key is missing or stale", canAskForKey(KEY_PROBLEM.MISSING) && canAskForKey(KEY_PROBLEM.STALE));
ok("asking does not help a locked device", !canAskForKey(KEY_PROBLEM.LOCKED));

ok("the request marker is recognised", isKeyRequest(KEY_REQUEST_MARKER) && isKeyRequest(` ${KEY_REQUEST_MARKER} `));
ok("ordinary text is not a request", !isKeyRequest("please send the key") && !isKeyRequest(null));
ok("the request previews as words", describeKeyRequest(KEY_REQUEST_MARKER).includes("key"));
ok("other text previews unchanged", describeKeyRequest("hello") === "hello");

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
