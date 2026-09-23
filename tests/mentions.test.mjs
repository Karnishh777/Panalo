// Mention parsing. Pure functions, no DOM, no network.
import { extractMentions, mentionsUser, splitMentions, mentionQueryAt, applyMention } from "../src/mentions.js";

let passed = 0;
const failures = [];
const ok = (l, c) => (c ? passed++ : failures.push(l));
const eq = (l, a, b) => ok(l, JSON.stringify(a) === JSON.stringify(b));

// ---- extraction ----
eq("finds a single mention", extractMentions("hey @ada how are you"), ["ada"]);
eq("finds several", extractMentions("@ada and @grace"), ["ada", "grace"]);
eq("de-duplicates", extractMentions("@ada @ada @Ada"), ["ada"]);
eq("lowercases", extractMentions("@AdaLovelace"), ["adalovelace"]);
eq("no mentions in plain text", extractMentions("just talking"), []);

// Punctuation belongs to the sentence, not the name -- getting this wrong
// means "@ada." silently notifies nobody.
eq("drops a trailing full stop", extractMentions("thanks @ada."), ["ada"]);
eq("drops trailing punctuation runs", extractMentions("@ada..."), ["ada"]);
eq("keeps inner dots", extractMentions("@ada.lovelace"), ["ada.lovelace"]);

// An email is not a mention. Treating it as one would notify a stranger and
// highlight text that isn't a person.
ok("an email address does not mention its domain", !extractMentions("mail me at ada@example.com").includes("example"));

// ---- does it name me ----
ok("matches my name", mentionsUser("hi @ada", "ada"));
ok("matches regardless of case", mentionsUser("hi @Ada", "ada") && mentionsUser("hi @ada", "Ada"));
ok("does not match someone else", !mentionsUser("hi @grace", "ada"));
ok("a bare name is not a mention", !mentionsUser("hi ada", "ada"));
ok("no username, no match", !mentionsUser("hi @ada", ""));

// ---- rendering pieces ----
const known = ["ada", "grace"];
eq("splits around a known mention",
   splitMentions("hi @ada bye", known).map((p) => p.type),
   ["text", "mention", "text"]);
eq("keeps the original text of the mention",
   splitMentions("hi @ada bye", known).find((p) => p.type === "mention").value, "@ada");
eq("someone not in the chat stays plain text",
   splitMentions("hi @stranger", known).map((p) => p.type), ["text"]);
eq("plain text is one piece", splitMentions("nothing here", known).map((p) => p.type), ["text"]);
// Reassembling the pieces must give back exactly the original, or the render
// silently drops or duplicates characters.
const sample = "hey @ada and @grace, see @stranger? end.";
ok("pieces reassemble to the original",
   splitMentions(sample, known).map((p) => p.value).join("") === sample);

// ---- composer autocomplete ----
eq("detects a mention being typed", mentionQueryAt("hi @ad", 6), { query: "ad", start: 3 });
eq("detects an empty mention just started", mentionQueryAt("hi @", 4), { query: "", start: 3 });
ok("no query mid-word", mentionQueryAt("email ada@example", 17) === null);
ok("no query in plain text", mentionQueryAt("just talking", 12) === null);
ok("no query after the mention is finished", mentionQueryAt("hi @ada done", 12) === null);

const applied = applyMention("hi @ad", 3, 6, "ada");
eq("completes the mention", applied.text, "hi @ada ");
eq("leaves the caret after the inserted name", applied.caret, 8);
const mid = applyMention("hi @ad there", 3, 6, "ada");
eq("keeps the rest of the line", mid.text, "hi @ada there");

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  x ${f}`));
  process.exitCode = 1;
}
