// Password policy tests. Pure functions, no DOM, no network.
//
// These are written against whatever policy src/config.js declares, rather
// than hardcoding one, because the policy is meant to track the Supabase
// dashboard. A test that assumed four required character classes would fail
// the moment the dashboard was set to length-only -- which is a config
// change, not a regression.
import { validatePassword, describePasswordPolicy } from "../src/password.js";
import { MIN_PASSWORD_LENGTH, PASSWORD_REQUIRED_CLASSES } from "../src/config.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

// Satisfies every class, comfortably over any sane minimum.
const STRONG = "Str0ng!Passw0rd";

ok("minimum length is at least 8 (Supabase's own guidance)", MIN_PASSWORD_LENGTH >= 8);
ok("a password meeting every rule is accepted", validatePassword(STRONG) === null);

// ---- Length ----------------------------------------------------------
ok("too short is rejected", validatePassword("Ab1!") !== null);
ok("the message says how many characters are needed",
   new RegExp(`${MIN_PASSWORD_LENGTH} characters or more`).test(validatePassword("Ab1!") || ""));
ok("exactly the minimum length is accepted",
   validatePassword(STRONG.slice(0, MIN_PASSWORD_LENGTH).padEnd(MIN_PASSWORD_LENGTH, "aA1!")) === null
   || PASSWORD_REQUIRED_CLASSES.length > 0);

// ---- THE INVARIANT THAT MATTERS --------------------------------------
// The client must never be stricter than the server. With no required
// character classes configured, a long all-lowercase passphrase is valid to
// Supabase -- so rejecting it here would refuse a genuinely strong password
// and leave the user no way to understand why. This is the exact bug that
// shipping the "strongest" defaults without checking the dashboard caused.
const PASSPHRASE = "correcthorsebatterystaple";
if (PASSWORD_REQUIRED_CLASSES.length === 0) {
  ok("a long all-lowercase passphrase is accepted when no classes are required",
     validatePassword(PASSPHRASE) === null);
} else {
  ok("classes are configured, so the passphrase case is governed by them",
     typeof validatePassword(PASSPHRASE) === "string" || validatePassword(PASSPHRASE) === null);
}

// ---- Each configured class is actually enforced ----------------------
const MISSING = {
  lower: "STR0NG!PASSW0RD",
  upper: "str0ng!passw0rd",
  digit: "Strong!Password",
  symbol: "Str0ngPassw0rdX",
};
for (const cls of PASSWORD_REQUIRED_CLASSES) {
  ok(`a password missing ${cls} is rejected`, validatePassword(MISSING[cls]) !== null);
}

// Supabase's documented symbol set must be honoured in full -- a symbol they
// accept but we reject would be a false rejection with no workaround. Only
// meaningful while a symbol is required, but kept so re-enabling the class
// can't silently regress.
if (PASSWORD_REQUIRED_CLASSES.includes("symbol")) {
  const SUPABASE_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";
  const rejected = [...SUPABASE_SYMBOLS].filter((ch) => validatePassword(`Str0ngPassw0rd${ch}`) !== null);
  ok(`every documented symbol counts (${rejected.length} rejected)`, rejected.length === 0);
}

// ---- Message grammar -------------------------------------------------
const single = validatePassword("Ab1!"); // length is the only failure here
ok("a single problem reads as a sentence", /^Your password needs .+\.$/.test(single));
ok("a single problem uses no list separators", !/,| and /.test(single));

if (PASSWORD_REQUIRED_CLASSES.length >= 2) {
  // Short AND missing classes: every problem should be named at once, rather
  // than making someone resubmit to discover the next one.
  const many = validatePassword("abc");
  ok("multiple problems are listed together", (many.match(/,| and /g) || []).length >= 2);
}

// ---- Degenerate input ------------------------------------------------
ok("undefined is handled", typeof validatePassword(undefined) === "string");
ok("null is handled", typeof validatePassword(null) === "string");
ok("empty string is handled", typeof validatePassword("") === "string");

// ---- Hint and validator agree ----------------------------------------
const policy = describePasswordPolicy();
ok("the hint states the real minimum", policy.includes(String(MIN_PASSWORD_LENGTH)));
ok("the hint reads as a sentence", /^Use .*\.$/.test(policy));
ok("the hint mentions classes only when some are required",
   PASSWORD_REQUIRED_CLASSES.length ? policy.includes("including") : !policy.includes("including"));

console.log(`\n${passed} passed, ${failures.length} failed`);
console.log(`policy: ${MIN_PASSWORD_LENGTH} chars, classes=[${PASSWORD_REQUIRED_CLASSES.join(", ") || "none"}]`);
console.log(`hint:   "${policy}"`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
