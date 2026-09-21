// Password policy tests. Pure functions, no DOM, no network.
import { validatePassword, describePasswordPolicy } from "../src/password.js";
import { MIN_PASSWORD_LENGTH, PASSWORD_REQUIRED_CLASSES } from "../src/config.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

// A password satisfying every class currently configured, at full length.
const STRONG = "Str0ng!Passw0rd";

ok("config minimum is at least 8 (Supabase's own guidance)", MIN_PASSWORD_LENGTH >= 8);
ok("a fully-compliant password is accepted", validatePassword(STRONG) === null);

// Length.
ok("too short is rejected", validatePassword("Ab1!") !== null);
ok("the rejection says how many characters are needed",
   /8 characters or more/.test(validatePassword("Ab1!") || ""));

// Each configured class must actually be enforced.
const MISSING = {
  lower: "STR0NG!PASSW0RD",
  upper: "str0ng!passw0rd",
  digit: "Strong!Password",
  symbol: "Str0ngPassw0rdX",
};
for (const cls of PASSWORD_REQUIRED_CLASSES) {
  ok(`a password missing ${cls} is rejected`, validatePassword(MISSING[cls]) !== null);
}

// All problems reported at once -- making someone resubmit to find the next
// failure is the behaviour this replaced.
const allWrong = validatePassword("abc");
ok("lists every problem in one message, not just the first",
   (allWrong.match(/,| and /g) || []).length >= 2);

// Supabase's documented symbol set must be honoured in full: a symbol they
// accept but we reject would be a false rejection with no explanation.
const SUPABASE_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";
const symbolFailures = [...SUPABASE_SYMBOLS].filter(
  (ch) => validatePassword(`Str0ngPassw0rd${ch}`) !== null
);
ok(`every documented symbol counts (${symbolFailures.length} rejected)`, symbolFailures.length === 0);

// Non-string input must not throw -- an empty field is a normal state.
ok("undefined is handled", typeof validatePassword(undefined) === "string");
ok("null is handled", typeof validatePassword(null) === "string");
ok("empty string is handled", typeof validatePassword("") === "string");

// The hint and the validator are generated from the same constants, so the
// text can't promise a rule the code doesn't enforce.
const policy = describePasswordPolicy();
ok("the hint states the real minimum", policy.includes(String(MIN_PASSWORD_LENGTH)));
ok("the hint reads as a sentence", /^Use .*\.$/.test(policy));

console.log(`\n${passed} passed, ${failures.length} failed`);
console.log(`policy hint: "${policy}"`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
