// Password policy, checked on this device before anything is sent.
//
// Supabase enforces the real rule server-side; this exists so the user finds
// out what's wrong while they're still typing, instead of filling in a whole
// signup form and getting a server error back. Three places needed the same
// logic (signup, password recovery, change password), which is reason enough
// for it to live in one file rather than three copies drifting apart.
//
// IMPORTANT: these rules must match Authentication → Sign In / Providers →
// Email in the Supabase dashboard. If the client is looser than the server,
// users get a confusing rejection after submitting. If it's stricter, they're
// refused a password the server would actually have accepted. Neither is
// fatal, but they should agree.

import { MIN_PASSWORD_LENGTH, PASSWORD_REQUIRED_CLASSES } from "./config.js";

// The symbol set is Supabase's documented list, copied exactly — a character
// they allow but we reject would be a false rejection with no explanation.
const SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

const CLASS_TESTS = {
  lower: { test: (p) => /[a-z]/.test(p), label: "a lowercase letter" },
  upper: { test: (p) => /[A-Z]/.test(p), label: "an uppercase letter" },
  digit: { test: (p) => /[0-9]/.test(p), label: "a number" },
  symbol: {
    test: (p) => [...p].some((ch) => SYMBOLS.includes(ch)),
    label: "a symbol",
  },
};

// Join a list the way a person would say it: "a, b and c".
function readableList(parts) {
  if (parts.length <= 1) return parts[0] || "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// Human-readable summary of the rule, for hint text under a password field.
// Shown up front, because a rule you only discover by breaking it is a bad
// rule.
export function describePasswordPolicy() {
  const classes = PASSWORD_REQUIRED_CLASSES.map((k) => CLASS_TESTS[k]?.label).filter(Boolean);
  const length = `at least ${MIN_PASSWORD_LENGTH} characters`;
  return classes.length ? `Use ${length}, including ${readableList(classes)}.` : `Use ${length}.`;
}

// Returns null when the password is acceptable, or a single sentence naming
// everything still missing. One message listing all the problems beats making
// someone resubmit to discover the next one.
export function validatePassword(password) {
  const value = typeof password === "string" ? password : "";
  const problems = [];

  if (value.length < MIN_PASSWORD_LENGTH) {
    problems.push(`${MIN_PASSWORD_LENGTH} characters or more`);
  }

  PASSWORD_REQUIRED_CLASSES
    .map((key) => CLASS_TESTS[key])
    .filter((rule) => rule && !rule.test(value))
    .forEach((rule) => problems.push(rule.label));

  return problems.length ? `Your password needs ${readableList(problems)}.` : null;
}
