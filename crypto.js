// crypto.js — PANALO client-side encryption engine (Web Crypto API, no libraries).
//
// Model: "encryption at rest, recoverable".
//   • Each user has an RSA-OAEP keypair. The PUBLIC key is shared; the PRIVATE key
//     is stored ENCRYPTED with a key derived from the user's password (PBKDF2), so
//     it can be recovered on any device by logging in — history is never lost.
//   • Each conversation has a random AES-GCM key, "wrapped" (encrypted) to each
//     member's public key. Members unwrap it with their private key.
//   • Messages are encrypted with the conversation key (AES-GCM). The server only
//     ever stores ciphertext.
//
// Honest limit: the encrypted private key and wrapped keys live on the server and
// the app's JS is served by the host, so this is strong privacy / encryption at
// rest with recovery — NOT zero-knowledge end-to-end encryption. Good tradeoff for
// a fast, recoverable web chat. Everything here is deterministic and AI-free.

const PanaloCrypto = (() => {
  const g = globalThis;
  const subtle = g.crypto && g.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // Iterations travel WITH each stored key (inside the blob itself — see
  // packEnvelope below) rather than living only here, so this can be raised
  // later without breaking recovery of keys already protected at a lower
  // count. New/rewrapped keys always use the current value; older rows
  // recover at whatever count they were actually protected with.
  const PBKDF2_ITERATIONS_CURRENT = 600000;
  const PBKDF2_ITERATIONS_LEGACY_DEFAULT = 200000; // rows predating the envelope
  const RSA = { name: "RSA-OAEP", hash: "SHA-256" };

  // ---- base64 <-> bytes (works in browser and Node) ----
  function bytesToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  }
  function b64ToBytes(b64) {
    const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function randomBytes(n) {
    return g.crypto.getRandomValues(new Uint8Array(n));
  }

  // ---- User keypair (RSA-OAEP 2048) ----
  async function generateUserKeypair() {
    return subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["wrapKey", "unwrapKey", "encrypt", "decrypt"]
    );
  }
  async function exportPublicKey(publicKey) {
    return bytesToB64(await subtle.exportKey("spki", publicKey));
  }
  async function importPublicKey(b64) {
    return subtle.importKey("spki", b64ToBytes(b64), RSA, true, ["wrapKey", "encrypt"]);
  }

  // ---- Protect / recover the private key with the user's password ----
  async function deriveWrapKey(password, saltBytes, iterations) {
    const baseKey = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  // The stored blob is self-describing: the iteration count lives INSIDE it,
  // next to the ciphertext it applies to.
  //
  // It used to live only in a separate key_iterations column. That coupled
  // recovery to a schema migration, and when the column was missing the count
  // was silently dropped on write while protection still used the raised
  // value — so recovery derived a different wrapping key and reported a
  // CORRECT password as wrong, orphaning that account's history for good.
  // Carrying the count with the ciphertext removes the schema from the
  // recovery path entirely. The column is still written when it exists, but
  // nothing depends on it any more.
  const ENVELOPE_VERSION = 1;

  function packEnvelope(ctB64, iterations) {
    return JSON.stringify({ v: ENVELOPE_VERSION, it: iterations, ct: ctB64 });
  }

  // Returns { ct, iterations } — iterations is null when the blob predates the
  // envelope and the count has to be inferred by the caller.
  function unpackEnvelope(stored) {
    if (typeof stored === "string" && stored.startsWith("{")) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.v === ENVELOPE_VERSION && typeof parsed.ct === "string") {
          return { ct: parsed.ct, iterations: Number(parsed.it) || null };
        }
      } catch {
        /* not an envelope — fall through to the legacy shape */
      }
    }
    return { ct: stored, iterations: null };
  }

  async function protectPrivateKey(privateKey, password, iterations = PBKDF2_ITERATIONS_CURRENT) {
    const pkcs8 = await subtle.exportKey("pkcs8", privateKey);
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const wrapKey = await deriveWrapKey(password, salt, iterations);
    const ct = await subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, pkcs8);
    return {
      encPrivateKey: packEnvelope(bytesToB64(ct), iterations),
      keySalt: bytesToB64(salt),
      keyIv: bytesToB64(iv),
      keyIterations: iterations,
    };
  }

  async function recoverPrivateKey({ encPrivateKey, keySalt, keyIv, keyIterations }, password) {
    const { ct, iterations: embedded } = unpackEnvelope(encPrivateKey);

    // Most specific source of truth first: the count carried with the
    // ciphertext, then the column, then — for rows that have neither — every
    // count this app has ever protected keys with. Trying both rescues the
    // accounts already orphaned by the dropped-column bug; without it they
    // would stay permanently locked out of their own history.
    const candidates = embedded
      ? [embedded]
      : keyIterations
        ? [keyIterations]
        : [PBKDF2_ITERATIONS_LEGACY_DEFAULT, PBKDF2_ITERATIONS_CURRENT];

    const salt = b64ToBytes(keySalt);
    const iv = b64ToBytes(keyIv);
    const body = b64ToBytes(ct);

    let lastError;
    for (const iterations of candidates) {
      try {
        const wrapKey = await deriveWrapKey(password, salt, iterations);
        const pkcs8 = await subtle.decrypt({ name: "AES-GCM", iv }, wrapKey, body);
        return await subtle.importKey("pkcs8", pkcs8, RSA, true, ["unwrapKey", "decrypt"]);
      } catch (e) {
        lastError = e; // wrong count, or genuinely the wrong password
      }
    }
    throw lastError;
  }

  // ---- Conversation key (AES-GCM 256), shared via public-key wrapping ----
  async function generateConversationKey() {
    return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  }
  async function wrapConversationKey(convKey, recipientPublicKey) {
    return bytesToB64(await subtle.wrapKey("raw", convKey, recipientPublicKey, { name: "RSA-OAEP" }));
  }
  async function unwrapConversationKey(b64, myPrivateKey) {
    return subtle.unwrapKey(
      "raw",
      b64ToBytes(b64),
      myPrivateKey,
      { name: "RSA-OAEP" },
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  // ---- Message encryption ----
  async function encryptMessage(plaintext, convKey) {
    const iv = randomBytes(12);
    const ct = await subtle.encrypt({ name: "AES-GCM", iv }, convKey, enc.encode(plaintext));
    return { ciphertext: bytesToB64(ct), iv: bytesToB64(iv) };
  }
  async function decryptMessage(ciphertextB64, ivB64, convKey) {
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivB64) }, convKey, b64ToBytes(ciphertextB64));
    return dec.decode(pt);
  }

  // ---- Identity fingerprint (short, human-comparable — for verifying contacts) ----
  async function fingerprint(b64PublicKey) {
    const hash = await subtle.digest("SHA-256", b64ToBytes(b64PublicKey));
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  }

  return {
    isSupported: () => !!subtle,
    generateUserKeypair, exportPublicKey, importPublicKey,
    protectPrivateKey, recoverPrivateKey,
    generateConversationKey, wrapConversationKey, unwrapConversationKey,
    encryptMessage, decryptMessage, fingerprint,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PanaloCrypto;
if (typeof window !== "undefined") window.PanaloCrypto = PanaloCrypto;
