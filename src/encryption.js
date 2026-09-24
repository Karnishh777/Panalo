// Encryption integration (uses the PanaloCrypto engine from crypto.js, loaded as a
// global). Keys are set up at login; the private key is cached in IndexedDB so
// reloads stay unlocked, and recovered from the password on a fresh device. If any
// part is unavailable, callers fall back to plaintext so messaging never breaks.
import { supabaseClient } from "./client.js";
import { state, conversationKeys } from "./state.js";
import { sendMode } from "./sendpolicy.js";

export function encryptionReady() {
  return !!(state.myPrivateKey && state.myPublicKeyB64 && window.PanaloCrypto && window.PanaloCrypto.isSupported());
}

// ---- IndexedDB cache for the decrypted private key ----
function openKeyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("panalo-keys", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function idbGetKey(id) {
  try {
    const db = await openKeyDb();
    return await new Promise((resolve) => {
      const r = db.transaction("keys", "readonly").objectStore("keys").get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
export async function idbSetKey(id, value) {
  try {
    const db = await openKeyDb();
    await new Promise((resolve) => {
      const r = db.transaction("keys", "readwrite").objectStore("keys").put(value, id);
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}
export async function idbDelKey(id) {
  try {
    const db = await openKeyDb();
    await new Promise((resolve) => {
      const r = db.transaction("keys", "readwrite").objectStore("keys").delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

// Store a freshly protected private key. Falls back to writing without
// key_iterations on a database that hasn't run supabase-phase7.sql yet — the
// key still works, it just recovers at the legacy iteration count.
async function upsertUserKeys(stored) {
  const row = {
    user_id: state.currentUser.id,
    enc_private_key: stored.encPrivateKey,
    key_salt: stored.keySalt,
    key_iv: stored.keyIv,
    key_iterations: stored.keyIterations,
  };
  let { error } = await supabaseClient.from("user_keys").upsert(row);
  if (error && /key_iterations/i.test(error.message)) {
    delete row.key_iterations;
    ({ error } = await supabaseClient.from("user_keys").upsert(row));
  }
  return error;
}

// Ensure this user's keypair is ready in memory.
//
// Returns a status rather than a bare boolean, because "the password was
// wrong" and "we couldn't create your keys" need different words in front of
// the user — conflating them is what made a correct password look rejected:
//   "ready"        · keys are in memory, encryption works
//   "needs-unlock" · keys exist on the server but not on this device
//   "wrong-password"
//   "setup-failed" · couldn't create or store keys
//   "unsupported"  · this browser has no Web Crypto
export async function ensureUserKeys(password) {
  if (!window.PanaloCrypto || !window.PanaloCrypto.isSupported()) return "unsupported";

  let keyQuery = await supabaseClient
    .from("user_keys")
    .select("enc_private_key, key_salt, key_iv, key_iterations")
    .eq("user_id", state.currentUser.id)
    .maybeSingle();
  // Graceful fallback until supabase-phase7.sql adds key_iterations —
  // recoverPrivateKey treats a missing value as the pre-phase7 default.
  if (keyQuery.error && /column/i.test(keyQuery.error.message)) {
    keyQuery = await supabaseClient
      .from("user_keys")
      .select("enc_private_key, key_salt, key_iv")
      .eq("user_id", state.currentUser.id)
      .maybeSingle();
  }
  const keyRow = keyQuery.data;
  const { data: profileRow } = await supabaseClient
    .from("profiles")
    .select("public_key")
    .eq("id", state.currentUser.id)
    .maybeSingle();

  const hasServerKeys = keyRow && profileRow && profileRow.public_key;

  if (hasServerKeys) {
    state.myPublicKeyB64 = profileRow.public_key;
    const cached = await idbGetKey(state.currentUser.id);
    if (cached) {
      state.myPrivateKey = cached;
      return "ready";
    }
    if (!password) return "needs-unlock";
    try {
      state.myPrivateKey = await window.PanaloCrypto.recoverPrivateKey(
        { encPrivateKey: keyRow.enc_private_key, keySalt: keyRow.key_salt, keyIv: keyRow.key_iv, keyIterations: keyRow.key_iterations },
        password
      );
      await idbSetKey(state.currentUser.id, state.myPrivateKey);
      return "ready";
    } catch {
      return "wrong-password";
    }
  }

  // First time for this user — needs the password to protect the new private key.
  if (!password) return "needs-unlock";
  try {
    // The profile row must exist first: user_keys.user_id references it, and an
    // UPDATE against a missing row silently matches nothing. Getting this order
    // wrong left brand-new accounts with no keys at all — so encryption stayed
    // off for them and the unlock screen blamed their password.
    const username = state.currentUser.user_metadata?.username || state.currentUser.email?.split("@")[0] || "user";
    const { error: profileError } = await supabaseClient
      .from("profiles")
      .upsert({ id: state.currentUser.id, username }, { onConflict: "id" });
    if (profileError) throw profileError;

    const kp = await window.PanaloCrypto.generateUserKeypair();
    state.myPublicKeyB64 = await window.PanaloCrypto.exportPublicKey(kp.publicKey);
    const stored = await window.PanaloCrypto.protectPrivateKey(kp.privateKey, password);

    // .select() so a write that matched no rows is detectable instead of silent.
    const { data: updated, error: pubError } = await supabaseClient
      .from("profiles")
      .update({ public_key: state.myPublicKeyB64 })
      .eq("id", state.currentUser.id)
      .select("id");
    if (pubError) throw pubError;
    if (!updated || !updated.length) throw new Error("public key was not saved");

    const keyError = await upsertUserKeys(stored);
    if (keyError) throw keyError;

    state.myPrivateKey = kp.privateKey;
    await idbSetKey(state.currentUser.id, state.myPrivateKey);
    return "ready";
  } catch (e) {
    console.error("Key setup failed:", e);
    return "setup-failed";
  }
}

// Generate a brand-new keypair for the current user, protected by the new
// password. Used as a last resort during password reset when the old private
// key isn't cached on this device — the honest cost is that any messages
// encrypted with the old key become unreadable forever.
export async function regenerateKeypair(password) {
  try {
    const kp = await window.PanaloCrypto.generateUserKeypair();
    state.myPublicKeyB64 = await window.PanaloCrypto.exportPublicKey(kp.publicKey);
    const stored = await window.PanaloCrypto.protectPrivateKey(kp.privateKey, password);

    const [{ error: pubErr }, keyErr] = await Promise.all([
      supabaseClient.from("profiles").update({ public_key: state.myPublicKeyB64 }).eq("id", state.currentUser.id),
      upsertUserKeys(stored),
    ]);
    if (pubErr || keyErr) throw pubErr || keyErr;

    state.myPrivateKey = kp.privateKey;
    await idbSetKey(state.currentUser.id, state.myPrivateKey);
    // Old wrapped conversation keys are useless with the new private key.
    conversationKeys.clear();
    return "ready";
  } catch (e) {
    console.error("Could not regenerate keypair:", e);
    return "failed";
  }
}

// Re-protect the private key with a new password.
//
// This MUST happen whenever the account password changes: the stored private
// key is encrypted with a key derived from the password, so a changed password
// without this leaves the blob unopenable — every message unreadable on any
// device that doesn't already have the key cached.
export async function rewrapPrivateKey(newPassword) {
  if (!state.myPrivateKey) return "no-key";
  try {
    const stored = await window.PanaloCrypto.protectPrivateKey(state.myPrivateKey, newPassword);
    const error = await upsertUserKeys(stored);
    if (error) throw error;
    return "ready";
  } catch (e) {
    console.error("Could not re-protect the private key:", e);
    return "failed";
  }
}

// Get (and cache) the AES key for a conversation by unwrapping our stored copy.
export async function getConversationKey(conversationId) {
  if (conversationKeys.has(conversationId)) return conversationKeys.get(conversationId);
  if (!state.myPrivateKey) return null;
  const { data } = await supabaseClient
    .from("conversation_keys")
    .select("wrapped_key")
    .eq("conversation_id", conversationId)
    .eq("user_id", state.currentUser.id)
    .maybeSingle();
  if (!data) return null;
  try {
    const key = await window.PanaloCrypto.unwrapConversationKey(data.wrapped_key, state.myPrivateKey);
    conversationKeys.set(conversationId, key);
    return key;
  } catch {
    return null;
  }
}

// Generate a conversation key and wrap it to every member, or adopt whoever
// got there first.
//
// The insert is deliberately one multi-row statement. PostgREST sends it as a
// single INSERT and Postgres applies it atomically, so two members racing to
// provision the same conversation cannot half-succeed: one writes every row,
// the other writes none and loses cleanly on the primary key. Were the rows
// inserted one at a time, an interleaved race could leave member A holding
// key A and member B holding key B for the same conversation -- each able to
// write messages the other could never read.
//
// The loser must then DISCARD the key it generated and take the winner's. An
// earlier version cached its own key without ever checking the insert error,
// which meant a failed write left the client encrypting with a key the
// server had never stored: unreadable to everyone, including the sender on
// their next device.
async function provisionKeyFor(conversationId, memberIds) {
  const { data: profs } = await supabaseClient.from("profiles").select("id, public_key").in("id", memberIds);
  const members = profs || [];
  // Any member without a public key could never unwrap this, so the chat
  // stays plaintext rather than locking someone out of it.
  if (members.length < memberIds.length || members.some((p) => !p.public_key)) {
    return { key: null, reason: "member-without-key" };
  }

  const convKey = await window.PanaloCrypto.generateConversationKey();
  const rows = [];
  for (const p of members) {
    const pub = await window.PanaloCrypto.importPublicKey(p.public_key);
    rows.push({
      conversation_id: conversationId,
      user_id: p.id,
      wrapped_key: await window.PanaloCrypto.wrapConversationKey(convKey, pub),
    });
  }

  const { error } = await supabaseClient.from("conversation_keys").insert(rows);
  if (error) {
    // Lost the race, or the write failed. Either way the key just generated
    // is worthless -- never cache it. Re-read whatever is actually stored.
    conversationKeys.delete(conversationId);
    return { key: await getConversationKey(conversationId), reason: "held-elsewhere" };
  }

  conversationKeys.set(conversationId, convKey);
  return { key: convKey, reason: "provisioned" };
}

// Warm the key cache for many conversations at once.
//
// getConversationKey() fetches one wrapped key per call, so anything that
// walks messages across several chats -- building the search index, most
// obviously -- pays a separate network round trip for each conversation it
// meets, strictly in sequence. Measured against the work it was blocking:
// decrypting a thousand messages costs about 19ms, while twenty of those
// round trips cost one to four SECONDS. The crypto was never the expensive
// part; the serialised fetches were.
//
// One query, one pass of unwrapping. Already-cached conversations are
// skipped, so calling this repeatedly is cheap.
export async function prefetchConversationKeys(conversationIds) {
  if (!state.myPrivateKey) return;
  const missing = [...new Set(conversationIds)].filter((id) => id && !conversationKeys.has(id));
  if (!missing.length) return;

  const { data } = await supabaseClient
    .from("conversation_keys")
    .select("conversation_id, wrapped_key")
    .eq("user_id", state.currentUser.id)
    .in("conversation_id", missing);

  for (const row of data || []) {
    try {
      conversationKeys.set(
        row.conversation_id,
        await window.PanaloCrypto.unwrapConversationKey(row.wrapped_key, state.myPrivateKey)
      );
    } catch {
      // A key we can't unwrap is left absent, so the caller falls back to
      // showing the message as locked rather than caching a broken entry.
    }
  }
}

// On conversation creation, make a fresh AES key and wrap it to every
// member's public key. Encrypt ONLY if every member already has a key, so
// nobody in the conversation is ever locked out (otherwise it stays
// plaintext, and ensureConversationKey below can fix that later).
export async function provisionConversationKey(conversationId, memberIds) {
  if (!encryptionReady()) return;
  try {
    await provisionKeyFor(conversationId, memberIds);
  } catch (e) {
    console.error("Could not set up conversation encryption:", e);
  }
}

// Give a conversation a key if it never got one.
//
// A chat created while any member was still setting up encryption got no key
// at all, and nothing ever revisited that decision -- so it stayed plaintext
// permanently, even once everyone in it had keys. That is a chat quietly
// less protected than the app implies, with no way for anyone to notice or
// repair it.
//
// Called when a conversation is opened. Returns { key, backfilled } so the
// caller can say something the first time it changes, rather than silently
// altering how a chat is protected.
export async function ensureConversationKey(conversationId, memberIds) {
  if (!encryptionReady()) return { key: null, backfilled: false, reason: "not-ready" };
  try {
    const existing = await getConversationKey(conversationId);
    if (existing) return { key: existing, backfilled: false, reason: "existing" };

    let ids = memberIds;
    if (!ids || !ids.length) {
      const { data: parts } = await supabaseClient
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", conversationId);
      ids = (parts || []).map((p) => p.user_id);
    }
    if (!ids.length) return { key: null, backfilled: false, reason: "no-members" };

    // "Backfilled" only when THIS device made the key. Losing the race to
    // another member and adopting theirs used to count too, which toasted
    // "encrypted from now on" for a chat that already was.
    const { key, reason } = await provisionKeyFor(conversationId, ids);
    return { key, backfilled: reason === "provisioned", reason };
  } catch (e) {
    console.error("Could not backfill conversation encryption:", e);
    return { key: null, backfilled: false, reason: "error" };
  }
}

// Whether any message in this conversation was ever sent encrypted. A chat
// with none has never had a key anyone used; a chat with some has a key,
// whether or not this device holds it.
async function hasEncryptedMessages(conversationId) {
  const { data, error } = await supabaseClient
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .not("iv", "is", null)
    .limit(1);
  // Unknown counts as yes: the answer only ever decides between refusing and
  // sending plaintext, and refusing is the direction that can be retried.
  if (error) return true;
  return !!(data && data.length);
}

// The key to send with, and whether sending is allowed at all -- decided by
// sendMode() (src/sendpolicy.js), never by the mere absence of a key. See that
// file for why the old "no key, so plaintext" fallback was dangerous.
//
// Returns { key, mode, locked }: `locked` is true when the refusal is because
// this device's private key is not unlocked, which needs different words than
// a chat whose key this device was never given.
export async function keyForSending(conversationId, memberIds) {
  const cryptoSupported = !!(window.PanaloCrypto && window.PanaloCrypto.isSupported());
  const hasPrivateKey = !!state.myPrivateKey;

  let key = hasPrivateKey ? await getConversationKey(conversationId) : null;
  let missingMemberKeys = false;
  let hasEncryptedHistory = false;

  if (!key && cryptoSupported && hasPrivateKey) {
    // The same repair openConversation() attempts: give a never-encrypted
    // chat a key if everyone in it can now hold one.
    const repaired = await ensureConversationKey(conversationId, memberIds);
    key = repaired.key;
    missingMemberKeys = repaired.reason === "member-without-key";
    if (!key && missingMemberKeys) hasEncryptedHistory = await hasEncryptedMessages(conversationId);
  }

  const mode = sendMode({ hasKey: !!key, cryptoSupported, hasPrivateKey, missingMemberKeys, hasEncryptedHistory });
  return { key, mode, locked: cryptoSupported && !hasPrivateKey };
}

// Resolve a message row to displayable plaintext (handles legacy unencrypted rows).
export async function messagePlaintext(msg) {
  if (!msg.content) return "";
  if (!msg.iv) return msg.content; // legacy / unencrypted message
  const convKey = await getConversationKey(msg.conversation_id);
  if (!convKey) return "🔒 Encrypted — unlock to read";
  try {
    return await window.PanaloCrypto.decryptMessage(msg.content, msg.iv, convKey);
  } catch {
    return "🔒 Unable to decrypt";
  }
}
