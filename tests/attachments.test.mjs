// Tests for the encrypted-attachment blob format.
//
// The module itself imports the Supabase client and touches URL.createObjectURL,
// neither of which exist in Node, so these exercise the FORMAT directly using
// the same primitives the module uses. That keeps the thing most likely to
// corrupt someone's file -- the byte layout -- under test.
import PanaloCrypto from "../crypto.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const HEADER_LENGTH_BYTES = 4;

async function pack(file, convKey) {
  const header = new TextEncoder().encode(JSON.stringify({ name: file.name, size: file.bytes.length, type: file.type }));
  const payload = new Uint8Array(HEADER_LENGTH_BYTES + header.length + file.bytes.length);
  new DataView(payload.buffer).setUint32(0, header.length);
  payload.set(header, HEADER_LENGTH_BYTES);
  payload.set(file.bytes, HEADER_LENGTH_BYTES + header.length);
  const { ciphertext, iv } = await PanaloCrypto.encryptBytes(payload, convKey);
  const blob = new Uint8Array(1 + IV_BYTES + ciphertext.byteLength);
  blob[0] = FORMAT_VERSION;
  blob.set(iv, 1);
  blob.set(new Uint8Array(ciphertext), 1 + IV_BYTES);
  return blob;
}

async function unpack(blob, convKey) {
  if (blob.length < 1 + IV_BYTES || blob[0] !== FORMAT_VERSION) return null;
  const iv = blob.slice(1, 1 + IV_BYTES);
  const ciphertext = blob.slice(1 + IV_BYTES);
  const payload = new Uint8Array(await PanaloCrypto.decryptBytes(ciphertext, iv, convKey));
  const headerLength = new DataView(payload.buffer, payload.byteOffset).getUint32(0);
  if (headerLength <= 0 || headerLength > payload.length - HEADER_LENGTH_BYTES) return null;
  const header = JSON.parse(new TextDecoder().decode(payload.slice(HEADER_LENGTH_BYTES, HEADER_LENGTH_BYTES + headerLength)));
  return { header, body: payload.slice(HEADER_LENGTH_BYTES + headerLength) };
}

async function main() {
  const key = await PanaloCrypto.generateConversationKey();
  const other = await PanaloCrypto.generateConversationKey();

  // A realistic binary file, not ASCII: every byte value must survive.
  const bytes = new Uint8Array(250000).map((_, i) => (i * 7 + 13) % 256);
  const file = { name: "passport-scan.jpg", type: "image/jpeg", bytes };

  const blob = await pack(file, key);
  const out = await unpack(blob, key);

  ok("round-trips the exact bytes", out.body.length === bytes.length && out.body.every((b, i) => b === bytes[i]));
  ok("round-trips the filename", out.header.name === file.name);
  ok("round-trips the MIME type", out.header.type === file.type);
  ok("round-trips the size", out.header.size === bytes.length);

  // THE POINT OF ALL THIS: nothing identifying may be readable in the stored
  // blob. Scan the raw bytes for the filename and MIME type as plain text.
  const asText = new TextDecoder("latin1").decode(blob);
  ok("the filename is NOT readable in the stored blob", !asText.includes("passport-scan"));
  ok("the MIME type is NOT readable in the stored blob", !asText.includes("image/jpeg"));
  ok("the file bytes are NOT the stored bytes", !blob.slice(1 + IV_BYTES, 1 + IV_BYTES + 64).every((b, i) => b === bytes[i]));

  // Size overhead must stay negligible -- base64 would have cost ~33%.
  const overhead = blob.length - bytes.length;
  ok(`overhead is a fixed handful of bytes (${overhead})`, overhead < 200);

  // Wrong key must fail, not return garbage.
  let wrongKeyRejected = false;
  try { await unpack(blob, other); } catch { wrongKeyRejected = true; }
  ok("a different conversation key cannot open it", wrongKeyRejected);

  // Tampering must be detected by AES-GCM, not silently decoded.
  const tampered = blob.slice();
  tampered[tampered.length - 20] ^= 0xff;
  let tamperRejected = false;
  try { await unpack(tampered, key); } catch { tamperRejected = true; }
  ok("a tampered blob is rejected", tamperRejected);

  // A truncated or foreign blob must be refused rather than misparsed.
  ok("a too-short blob is refused", (await unpack(new Uint8Array([1, 2, 3]), key)) === null);
  const wrongVersion = blob.slice();
  wrongVersion[0] = 99;
  ok("an unknown format version is refused", (await unpack(wrongVersion, key)) === null);

  // Empty files and unicode names are ordinary, not edge cases users avoid.
  const odd = { name: "résumé 📄.pdf", type: "application/pdf", bytes: new Uint8Array(0) };
  const oddOut = await unpack(await pack(odd, key), key);
  ok("handles a zero-byte file", oddOut.body.length === 0);
  ok("handles a unicode filename", oddOut.header.name === odd.name);

  // Each upload must use a fresh IV, or identical files become linkable.
  const a = await pack(file, key);
  const b = await pack(file, key);
  const ivA = a.slice(1, 1 + IV_BYTES).join();
  const ivB = b.slice(1, 1 + IV_BYTES).join();
  ok("the same file encrypts differently each time", ivA !== ivB);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  x ${f}`));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error("Test run crashed:", e); process.exitCode = 1; });
