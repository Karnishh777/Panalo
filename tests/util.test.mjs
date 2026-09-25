// Tests for the pure helpers in src/util.js. No DOM is touched at import
// time, so this runs in plain Node.
import { mapLimited, splitLinks, emojiCount } from "../src/util.js";

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

  // ---- splitLinks -----------------------------------------------------
  // Message text is attacker-controlled; the only hrefs that may come out
  // are http(s), and the text around them must survive untouched.
  const links = (t) => splitLinks(t).filter((p) => p.type === "link");
  const joined = (t) => splitLinks(t).map((p) => p.value).join("");
  ok("plain text is one text part", splitLinks("hello there").length === 1 && splitLinks("hello there")[0].type === "text");
  ok("finds an https link", links("see https://example.com/a?b=1 now")[0]?.href === "https://example.com/a?b=1");
  ok("www. gets https://", links("go to www.example.org")[0]?.href === "https://www.example.org");
  ok("trailing full stop isn't part of the link", links("read https://example.com.")[0]?.value === "https://example.com");
  ok("trailing comma isn't part of the link", links("https://a.io/x, then")[0]?.value === "https://a.io/x");
  ok("wrapping parens aren't part of the link", links("(https://a.io/x)")[0]?.value === "https://a.io/x");
  ok("balanced parens inside a link are kept", links("https://en.wikipedia.org/wiki/Foo_(bar)")[0]?.value === "https://en.wikipedia.org/wiki/Foo_(bar)");
  ok("javascript: is never a link", links("javascript:alert(1)").length === 0);
  ok("data: is never a link", links("data:text/html,<b>x</b>").length === 0);
  ok("quotes end a link", links('"https://a.io/x"onmouseover=1')[0]?.value === "https://a.io/x");
  ok("angle brackets end a link", links("<https://a.io/x>")[0]?.value === "https://a.io/x");
  ok("every character survives the split", joined("a https://x.io/b. c www.y.org!") === "a https://x.io/b. c www.y.org!");
  ok("two links, text between", links("https://a.io and https://b.io").length === 2);
  ok("bare www. is not a link", links("www. nothing").length === 0);

  // ---- emojiCount -----------------------------------------------------
  ok("one emoji", emojiCount("🔥") === 1);
  ok("three emoji", emojiCount("😂😂😂") === 3);
  ok("four is text-sized", emojiCount("😂😂😂😂") === 0);
  ok("emoji with a word is text", emojiCount("🔥 lit") === 0);
  ok("digits are not emoji", emojiCount("123") === 0);
  ok("ZWJ family counts as one", emojiCount("👨‍👩‍👧") === 1);
  ok("skin tone counts as one", emojiCount("👍🏽") === 1);
  ok("flag counts as one", emojiCount("🇵🇭") === 1);
  ok("heart with variation selector", emojiCount("❤️") === 1);
  ok("empty is not emoji", emojiCount("   ") === 0);
  ok("punctuation is text", emojiCount("!!") === 0);

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
