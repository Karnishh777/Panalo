// Encrypted attachments.
//
// Message text has been encrypted on the device for a long time; the files
// attached to those messages were not. They were uploaded exactly as chosen
// and served from a public bucket, with the original filename and byte size
// written into the storage path. So a chat could be unreadable to the server
// while the photo in it was not, and "passport-scan.jpg" was legible without
// decrypting anything at all.
//
// Format of a stored blob:
//
//   [1 byte version][12 byte IV][ AES-GCM ciphertext ................. ]
//                                        |
//                    decrypts to --------+
//   [4 byte header length][header JSON][file bytes ...................]
//
// The header carries the filename, size and MIME type, so those are
// ciphertext too rather than sitting in the path. The IV travels with the
// blob for the same reason the PBKDF2 iteration count travels with the key:
// a value needed to decrypt something should not live somewhere it can drift
// away from the thing it decrypts.
//
// Two things this deliberately does NOT do:
//
//   - Avatars stay unencrypted. They are shown to people who share no
//     conversation key with the owner -- that is the entire point of an
//     avatar -- so no key exists that could encrypt one and still let the
//     right people see it. The UI says so rather than implying otherwise.
//   - A conversation with no key still uploads in the clear, exactly as its
//     messages are still sent in the clear. Encrypting the attachment while
//     the message beside it is plaintext would be theatre.

import { supabaseClient } from "./client.js";
import { safeImageUrl } from "./util.js";

const BUCKET = "chat-files";
// Encrypted uploads live under this prefix. Anything outside it predates
// encryption and must keep rendering -- people's existing photos are not
// disposable.
const ENC_PREFIX = "enc/";
const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const HEADER_LENGTH_BYTES = 4;

// Decrypted blobs are held as object URLs, which the browser will not free on
// its own. A long scroll through an image-heavy chat would otherwise pin
// every photo decrypted along the way in memory until the tab closed.
const MAX_CACHED = 40;
const cache = new Map(); // storage url -> { objectUrl, name, size, type }

export function isEncryptedAttachment(url) {
  return typeof url === "string" && url.includes(`/${BUCKET}/${ENC_PREFIX}`);
}

// Map iteration order is insertion order, so the first entry is the oldest.
function evictOldest() {
  while (cache.size > MAX_CACHED) {
    const [oldestUrl, entry] = cache.entries().next().value;
    URL.revokeObjectURL(entry.objectUrl);
    cache.delete(oldestUrl);
  }
}

// Drop everything we hold, so decrypted attachments don't outlive the session
// that was allowed to see them.
export function clearAttachmentCache() {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.objectUrl);
  cache.clear();
}

// ---- Upload ----------------------------------------------------------

// Encrypt `file` and upload it. Returns the public URL, which now points at
// ciphertext. Throws on failure so the caller marks the send as failed rather
// than quietly shipping the file in the clear.
export async function uploadEncrypted(file, convKey) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextEncoder().encode(
    JSON.stringify({ name: file.name || "file", size: file.size, type: file.type || "" })
  );

  const payload = new Uint8Array(HEADER_LENGTH_BYTES + header.length + bytes.length);
  new DataView(payload.buffer).setUint32(0, header.length);
  payload.set(header, HEADER_LENGTH_BYTES);
  payload.set(bytes, HEADER_LENGTH_BYTES + header.length);

  const { ciphertext, iv } = await window.PanaloCrypto.encryptBytes(payload, convKey);

  const blob = new Uint8Array(1 + IV_BYTES + ciphertext.byteLength);
  blob[0] = FORMAT_VERSION;
  blob.set(iv, 1);
  blob.set(new Uint8Array(ciphertext), 1 + IV_BYTES);

  // The path carries nothing: no name, no extension, no size. Everything
  // describing the file is inside the ciphertext.
  const path = `${ENC_PREFIX}${Date.now()}_${crypto.randomUUID()}`;
  const { error } = await supabaseClient.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "application/octet-stream" });
  if (error) throw error;

  return supabaseClient.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Seed the cache with a file we already hold in memory, so the sender does
// not immediately re-download and re-decrypt the thing they just uploaded --
// which for a 50 MB attachment is a pointless round trip over their own
// connection.
export function primeAttachmentCache(url, file) {
  if (!url || cache.has(url)) return;
  cache.set(url, {
    objectUrl: URL.createObjectURL(file),
    name: file.name || "file",
    size: file.size,
    type: file.type || "",
  });
  evictOldest();
}

// ---- Download --------------------------------------------------------

// Fetch, decrypt, and hand back something renderable. Returns null when the
// attachment can't be opened -- a missing conversation key, a tampered blob,
// a failed fetch -- so callers can show "unavailable" rather than a broken
// image icon with no explanation.
export async function loadEncrypted(url, convKey) {
  if (cache.has(url)) return cache.get(url);
  const safe = safeImageUrl(url); // same origin allow-list as everything else
  if (!safe || !convKey) return null;

  try {
    const response = await fetch(safe);
    if (!response.ok) return null;
    const raw = new Uint8Array(await response.arrayBuffer());
    if (raw.length < 1 + IV_BYTES || raw[0] !== FORMAT_VERSION) return null;

    const iv = raw.slice(1, 1 + IV_BYTES);
    const ciphertext = raw.slice(1 + IV_BYTES);
    const payload = new Uint8Array(await window.PanaloCrypto.decryptBytes(ciphertext, iv, convKey));
    if (payload.length < HEADER_LENGTH_BYTES) return null;

    const headerLength = new DataView(payload.buffer, payload.byteOffset).getUint32(0);
    // A corrupt length would otherwise slice far outside the payload and
    // surface much later as something harder to diagnose.
    if (headerLength <= 0 || headerLength > payload.length - HEADER_LENGTH_BYTES) return null;

    const header = JSON.parse(
      new TextDecoder().decode(payload.slice(HEADER_LENGTH_BYTES, HEADER_LENGTH_BYTES + headerLength))
    );
    const body = payload.slice(HEADER_LENGTH_BYTES + headerLength);

    const entry = {
      objectUrl: URL.createObjectURL(new Blob([body], { type: header.type || "application/octet-stream" })),
      name: header.name || "file",
      size: typeof header.size === "number" ? header.size : body.length,
      type: header.type || "",
    };
    cache.set(url, entry);
    evictOldest();
    return entry;
  } catch {
    return null; // wrong key, tampered ciphertext, or the network
  }
}

// Whether a decrypted attachment is an image. The path no longer carries an
// extension to guess from, so this reads the encrypted header instead.
export function isImageEntry(entry) {
  return !!entry && typeof entry.type === "string" && entry.type.startsWith("image/");
}
