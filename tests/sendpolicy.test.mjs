// Tests for the rule that decides whether a message may leave this device,
// and in what form. Pure, so it runs in plain Node.
//
// The rule exists because sendMessage() used to fall back to plaintext
// whenever it had no conversation key -- including in chats that ARE
// encrypted, where this device simply lacked its copy of the key. Commit
// 577baf7 closed one road into that state (a login that could not unwrap the
// private key); this closes the rest.
import { SEND, sendMode } from "../src/sendpolicy.js";
import { cleanUsername } from "../src/util.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

const base = { hasKey: false, cryptoSupported: true, hasPrivateKey: true, missingMemberKeys: false, hasEncryptedHistory: false };

// ---- sendMode --------------------------------------------------------------
ok("encrypts whenever the key is available",
   sendMode({ ...base, hasKey: true }) === SEND.ENCRYPT);

ok("encrypts even if other signals look odd, as long as there is a key",
   sendMode({ ...base, hasKey: true, missingMemberKeys: true, hasEncryptedHistory: true }) === SEND.ENCRYPT);

ok("refuses when the chat has a key this device cannot open",
   sendMode({ ...base }) === SEND.REFUSE);

ok("refuses when this device's private key is locked",
   sendMode({ ...base, hasPrivateKey: false }) === SEND.REFUSE);

ok("sends plaintext in a browser with no Web Crypto at all (the app already says so)",
   sendMode({ ...base, cryptoSupported: false, hasPrivateKey: false }) === SEND.PLAINTEXT);

ok("sends plaintext when a member has never set up encryption and nothing was ever encrypted",
   sendMode({ ...base, missingMemberKeys: true }) === SEND.PLAINTEXT);

ok("refuses when a member lacks keys but the chat already has encrypted messages",
   sendMode({ ...base, missingMemberKeys: true, hasEncryptedHistory: true }) === SEND.REFUSE);

ok("defaults to refusing, not plaintext, when told nothing",
   sendMode({}) === SEND.REFUSE);

// ---- cleanUsername ---------------------------------------------------------
// "@ishana1318" came back "not found": the lookup was given the @ literally.
ok("strips a leading @", cleanUsername("@ishana1318") === "ishana1318");
ok("strips several leading @", cleanUsername("@@ishana1318") === "ishana1318");
ok("trims around the @", cleanUsername("  @ ishana1318 ") === "ishana1318");
ok("leaves a plain name alone", cleanUsername("Heisenberg") === "Heisenberg");
ok("keeps an @ that is not leading", cleanUsername("a@b") === "a@b");
ok("turns nothing into an empty string", cleanUsername(undefined) === "" && cleanUsername(null) === "");

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
