// Golden-file tests for the deterministic text assistance rules.
// Run: node tests/textassist.test.mjs
//
// Every rule is input → expected output. If a rule ever changes behaviour, one
// of these fails — which is the whole point of keeping the logic pure.
import {
  fixTypo, smartPunctuation, autoCapitalize, tidySpacing, assist, assistOnWordBoundary,
} from "../src/textassist.js";

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failures.push(`${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

// ---- Typo dictionary ----
check("teh → the", fixTypo("teh"), "the");
check("preserves Capitalised", fixTypo("Teh"), "The");
check("preserves UPPERCASE", fixTypo("TEH"), "THE");
check("leaves real words alone", fixTypo("hello"), "hello");
check("leaves slang alone", fixTypo("u"), "u");
check("leaves slang alone (rn)", fixTypo("rn"), "rn");
check("adds missing apostrophe", fixTypo("dont"), "don't");
check("im → I'm", fixTypo("im"), "I'm");

// ---- Smart punctuation ----
check("double hyphen → em dash", smartPunctuation("wait--what"), "wait—what");
check("three dots → ellipsis", smartPunctuation("hmm..."), "hmm…");
check("many dots → one ellipsis", smartPunctuation("hmm......"), "hmm…");
check("apostrophe curls", smartPunctuation("don't"), "don’t");
check("quotes curl in pairs", smartPunctuation('say "hi" now'), "say “hi” now");
check("opening quote at start", smartPunctuation('"hi"'), "“hi”");

// ---- Capitalisation ----
check("first letter", autoCapitalize("hello there"), "Hello there");
check("after full stop", autoCapitalize("hi. how are you"), "Hi. How are you");
check("after question mark", autoCapitalize("ok? sure"), "Ok? Sure");
check("lone i → I", autoCapitalize("i think i am"), "I think I am");
check("i'm → I'm", autoCapitalize("i'm here"), "I'm here");
check("leaves SHOUTING alone", autoCapitalize("STOP RIGHT THERE"), "STOP RIGHT THERE");
check("doesn't touch mid-word i", autoCapitalize("this is fine"), "This is fine");

// ---- Spacing ----
check("collapses runs of spaces", tidySpacing("a    b"), "a b");
check("trims ends", tidySpacing("  hi  "), "hi");
check("keeps newlines", tidySpacing("a\nb"), "a\nb");

// ---- Everything together ----
check("full pipeline", assist("teh cat dont care... i saw it"), "The cat don’t care… I saw it");
check("respects disabled typos", assist("teh cat", { typos: false }), "Teh cat");
check("respects disabled capitals", assist("teh cat", { capitals: false }), "the cat");
check("empty stays empty", assist(""), "");
check("leaves a clean sentence unchanged", assist("Hello, how are you?"), "Hello, how are you?");

// ---- As-you-type ----
const t1 = assistOnWordBoundary("say teh ", 8);
check("corrects the word just finished", t1?.text, "say the ");
check("cursor follows the correction", String(t1?.cursor), "8");

const t2 = assistOnWordBoundary("say hello ", 10);
check("no correction for a good word", t2, null);

// The first word of a message starts a sentence, so it gets capitalised —
// the same thing a phone keyboard does.
const t1b = assistOnWordBoundary("teh ", 4);
check("first word: fixed and capitalised", t1b?.text, "The ");
const t2b = assistOnWordBoundary("hello ", 6);
check("first word: capitalised even when spelled right", t2b?.text, "Hello ");

const t3 = assistOnWordBoundary("i ", 2);
check("lifts lone i", t3?.text, "I ");

const t4 = assistOnWordBoundary("hi. teh ", 8);
check("capitalises after a full stop", t4?.text, "hi. The ");

const t5 = assistOnWordBoundary("teh", 3);
check("waits for the word boundary", t5, null);

const t6 = assistOnWordBoundary("say teh word", 8);
check("corrects mid-sentence, keeps the tail", t6?.text, "say the word");

// ---- Report ----
if (failures.length) {
  console.error(`❌ ${failures.length} failing, ${passed} passing\n`);
  failures.forEach((f) => console.error("  • " + f));
  process.exit(1);
}
console.log(`✅ all ${passed} text-assistance tests passed`);
