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

  const PBKDF2_ITERATIONS = 200000;
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
  async function deriveWrapKey(password, saltBytes) {
    const baseKey = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  async function protectPrivateKey(privateKey, password) {
    const pkcs8 = await subtle.exportKey("pkcs8", privateKey);
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const wrapKey = await deriveWrapKey(password, salt);
    const ct = await subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, pkcs8);
    return { encPrivateKey: bytesToB64(ct), keySalt: bytesToB64(salt), keyIv: bytesToB64(iv) };
  }
  async function recoverPrivateKey({ encPrivateKey, keySalt, keyIv }, password) {
    const wrapKey = await deriveWrapKey(password, b64ToBytes(keySalt));
    const pkcs8 = await subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(keyIv) }, wrapKey, b64ToBytes(encPrivateKey));
    return subtle.importKey("pkcs8", pkcs8, RSA, true, ["unwrapKey", "decrypt"]);
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
