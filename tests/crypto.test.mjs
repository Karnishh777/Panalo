// Round-trip tests for the client-side encryption engine (crypto.js).
// Pure Web Crypto, no network — runs the same in Node as in the browser.
// Run: node tests/crypto.test.mjs
import PanaloCrypto from "../crypto.js";

let passed = 0;
const failures = [];

function ok(label, cond) {
  if (cond) passed++;
  else failures.push(label);
}

async function expectThrow(label, fn) {
  try {
    await fn();
    failures.push(`${label} (expected to throw, didn't)`);
  } catch {
    passed++;
  }
}

async function main() {
  // ---- User keypair: export/import round-trip ----
  const kp = await PanaloCrypto.generateUserKeypair();
  const pubB64 = await PanaloCrypto.exportPublicKey(kp.publicKey);
  ok("exported public key is base64 text", typeof pubB64 === "string" && pubB64.length > 0);
  const importedPub = await PanaloCrypto.importPublicKey(pubB64);
  ok("imported public key is usable", !!importedPub);

  // ---- Private key protection: correct password recovers it ----
  const password = "correct horse battery staple";
  const stored = await PanaloCrypto.protectPrivateKey(kp.privateKey, password);
  ok("protectPrivateKey returns all stored fields", !!(stored.encPrivateKey && stored.keySalt && stored.keyIv && stored.keyIterations));
  ok("new keys use the current (raised) iteration count", stored.keyIterations >= 600000);

  const recovered = await PanaloCrypto.recoverPrivateKey(stored, password);
  ok("recovered private key is usable", !!recovered);

  // Prove it's really the same key: wrap a conversation key with the public
  // key, unwrap with the recovered private key, and check it still works.
  const convKey = await PanaloCrypto.generateConversationKey();
  const wrapped = await PanaloCrypto.wrapConversationKey(convKey, kp.publicKey);
  const unwrapped = await PanaloCrypto.unwrapConversationKey(wrapped, recovered);
  const { ciphertext, iv } = await PanaloCrypto.encryptMessage("hello from the original key", unwrapped);
  const plaintext = await PanaloCrypto.decryptMessage(ciphertext, iv, convKey);
  ok("key recovered via password can decrypt what the original key encrypted", plaintext === "hello from the original key");

  // ---- Wrong password must NOT recover the key ----
  await expectThrow("wrong password fails to recover the private key", () => PanaloCrypto.recoverPrivateKey(stored, "definitely not the password"));

  // ---- Backward compatibility: a key protected at the OLD iteration count
  // (simulating a row from before the count was raised) must still recover
  // correctly when its stored keyIterations is passed through. This is the
  // actual safety property the migration depends on: raising the constant
  // must never break already-stored keys. ----
  const legacyIterations = 200000;
  const legacyStored = await PanaloCrypto.protectPrivateKey(kp.privateKey, password, legacyIterations);
  ok("a key can still be protected at the legacy iteration count", legacyStored.keyIterations === legacyIterations);
  const legacyRecovered = await PanaloCrypto.recoverPrivateKey(legacyStored, password);
  ok("a legacy-iteration key recovers correctly when keyIterations is supplied", !!legacyRecovered);

  // A row from before the key_iterations COLUMN existed has no such field at
  // all (undefined, not 200000) — recoverPrivateKey must fall back to the
  // legacy default rather than deriving with `undefined` iterations.
  const rowMissingColumn = { ...legacyStored, keyIterations: undefined };
  const fallbackRecovered = await PanaloCrypto.recoverPrivateKey(rowMissingColumn, password);
  ok("a row with no keyIterations field at all still recovers (defaults to legacy count)", !!fallbackRecovered);

  // ---- Conversation key wrap/unwrap for a second recipient ----
  const kp2 = await PanaloCrypto.generateUserKeypair();
  const wrappedFor2 = await PanaloCrypto.wrapConversationKey(convKey, kp2.publicKey);
  const unwrappedBy2 = await PanaloCrypto.unwrapConversationKey(wrappedFor2, kp2.privateKey);
  const enc2 = await PanaloCrypto.encryptMessage("shared secret", unwrappedBy2);
  const dec2 = await PanaloCrypto.decryptMessage(enc2.ciphertext, enc2.iv, convKey);
  ok("a second recipient's unwrapped key decrypts what the original key encrypted", dec2 === "shared secret");

  // The other person's private key must NOT unwrap a key wrapped for someone else.
  await expectThrow("recipient 2's private key cannot unwrap a key wrapped for recipient 1", () =>
    PanaloCrypto.unwrapConversationKey(wrapped, kp2.privateKey)
  );

  // ---- Message encryption: IVs are random per call (never reused) ----
  const encA = await PanaloCrypto.encryptMessage("same plaintext", convKey);
  const encB = await PanaloCrypto.encryptMessage("same plaintext", convKey);
  ok("encrypting the same plaintext twice uses different IVs", encA.iv !== encB.iv);
  ok("...and therefore produces different ciphertext", encA.ciphertext !== encB.ciphertext);
  ok("both still decrypt to the original plaintext", (await PanaloCrypto.decryptMessage(encA.ciphertext, encA.iv, convKey)) === "same plaintext");

  // Tampered ciphertext must fail to decrypt (AES-GCM authentication).
  const tampered = encA.ciphertext.slice(0, -4) + (encA.ciphertext.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
  await expectThrow("a tampered ciphertext fails AES-GCM authentication", () => PanaloCrypto.decryptMessage(tampered, encA.iv, convKey));

  // ---- Fingerprint: deterministic, and differs for different keys ----
  const fp1 = await PanaloCrypto.fingerprint(pubB64);
  const fp1Again = await PanaloCrypto.fingerprint(pubB64);
  const pub2B64 = await PanaloCrypto.exportPublicKey(kp2.publicKey);
  const fp2 = await PanaloCrypto.fingerprint(pub2B64);
  ok("fingerprint is deterministic for the same key", fp1 === fp1Again);
  ok("fingerprint differs for different keys", fp1 !== fp2);

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
