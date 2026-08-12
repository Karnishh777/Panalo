// Deterministic writing help. Rules and a dictionary — no ML, no model, no
// network. Every function here is pure, which is what makes the behaviour
// testable (see tests/textassist.test.mjs) and guarantees no message text ever
// leaves the device.
//
// Spell-check is deliberately NOT implemented here: the roadmap suggested
// lazy-loading Hunspell dictionaries (~1 MB per language), but every browser
// already ships a spell-checker for text fields. Turning that on costs one
// attribute and zero bytes, so the dictionary download would buy nothing.

// Typos worth fixing are ones a person makes by transposing or dropping keys
// and would always want corrected — never real words, and never slang, which
// is a deliberate choice for a Gen-Z audience ("u", "ur", "rn" stay untouched).
const TYPOS = new Map(Object.entries({
  teh: "the", hte: "the", tehn: "then", thn: "then", taht: "that", thta: "that",
  adn: "and", nad: "and", nd: "and", ans: "and",
  yuo: "you", oyu: "you", yoy: "you", yuor: "your", yoru: "your",
  wiht: "with", whit: "with", wtih: "with", woudl: "would", coudl: "could", shoudl: "should",
  becuase: "because", becasue: "because", becuse: "because",
  waht: "what", hwat: "what", wehn: "when", hwen: "when", wher: "where", wehre: "where",
  jsut: "just", jstu: "just", knwo: "know", konw: "know", nwo: "now",
  liek: "like", tihs: "this", htis: "this", tehre: "there", thier: "their",
  recieve: "receive", recieved: "received", beleive: "believe", freind: "friend",
  seperate: "separate", definately: "definitely", definatly: "definitely",
  tomorow: "tomorrow", tommorow: "tomorrow", tommorrow: "tomorrow",
  alot: "a lot", cant: "can't", dont: "don't", wont: "won't", im: "I'm",
  ive: "I've", ill: "I'll", isnt: "isn't", didnt: "didn't", doesnt: "doesn't",
  wasnt: "wasn't", couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't",
  thats: "that's", whats: "what's", lets: "let's", youre: "you're", theyre: "they're",
  its: "it's", // "its" as a possessive is rarer in chat than "it's"
  sry: "sorry", srry: "sorry", plz: "please", pls: "please",
  goign: "going", gonig: "going", comming: "coming", runing: "running",
  reallly: "really", realy: "really", verry: "very", finaly: "finally",
  suprise: "surprise", suprised: "surprised", untill: "until", allready: "already",
  arent: "aren't", havent: "haven't", hasnt: "hasn't", werent: "weren't",
}));

// Correct a single word, preserving how it was capitalised.
export function fixTypo(word) {
  const lower = word.toLowerCase();
  const fixed = TYPOS.get(lower);
  if (!fixed) return word;
  if (word === lower) return fixed;                       // all lower → as-is
  if (word === word.toUpperCase() && word.length > 1) return fixed.toUpperCase();
  return fixed.charAt(0).toUpperCase() + fixed.slice(1);  // Capitalised
}

export function isTypo(word) {
  return TYPOS.has(word.toLowerCase());
}

// Straight quotes → curly, -- → em dash, ... → ellipsis.
// Quote direction is decided by what precedes the quote, so it works mid-word
// (don't → don’t) as well as around phrases.
export function smartPunctuation(text) {
  return text
    .replace(/--/g, "—")
    .replace(/\.{3,}/g, "…")
    .replace(/(^|[\s([{"“])'/g, "$1‘")   // opening single
    .replace(/'/g, "’")                   // everything else is an apostrophe
    .replace(/(^|[\s([{'‘])"/g, "$1“")   // opening double
    .replace(/"/g, "”");
}

// Capitalise the first letter of the text and of each new sentence, and lift a
// lone "i" to "I". Leaves the rest of the casing alone — SHOUTING is a choice.
export function autoCapitalize(text) {
  let out = text.replace(/(^|[.!?…]\s+|\n\s*)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
  out = out.replace(/\bi\b/g, "I");
  out = out.replace(/\bi'/g, "I'").replace(/\bi’/g, "I’");
  return out;
}

// Collapse runs of spaces and trim; never touches newlines.
export function tidySpacing(text) {
  return text.replace(/[^\S\n]{2,}/g, " ").trim();
}

// Everything, in the order that makes the rules compose correctly: typos first
// (so "dont" becomes "don't" before quotes are curled), then punctuation, then
// capitalisation.
export function assist(text, opts = {}) {
  if (!text) return text;
  const { typos = true, punctuation = true, capitals = true, spacing = true } = opts;

  let out = text;
  if (typos) {
    out = out.replace(/[A-Za-z']+/g, (word) => fixTypo(word));
  }
  if (punctuation) out = smartPunctuation(out);
  if (capitals) out = autoCapitalize(out);
  if (spacing) out = tidySpacing(out);
  return out;
}

// ---- As-you-type ----
// Corrects the word you just finished, the way a phone keyboard does. Returns
// { text, cursor, correction } or null when nothing changed.
export function assistOnWordBoundary(text, cursor, opts = {}) {
  const { typos = true, capitals = true } = opts;
  // Only act right after a word-ending character was typed.
  const before = text.slice(0, cursor);
  const m = before.match(/([A-Za-z']+)([\s.,!?;:]) *$/);
  if (!m) return null;

  const [, word, boundary] = m;
  let replacement = word;
  if (typos) replacement = fixTypo(word);
  if (capitals && replacement === "i") replacement = "I";

  // Capitalise a word that starts a sentence.
  if (capitals) {
    const upToWord = before.slice(0, before.length - m[0].length);
    if (/(^|[.!?…]\s+|\n\s*)$/.test(upToWord)) {
      replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
  }
  if (replacement === word) return null;

  const start = cursor - m[0].length;
  const next = text.slice(0, start) + replacement + boundary + text.slice(cursor);
  return {
    text: next,
    cursor: cursor + (replacement.length - word.length),
    correction: { from: word, to: replacement, start },
  };
}
