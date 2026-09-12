// Encryption integration (uses the PanaloCrypto engine from crypto.js, loaded as a
// global). Keys are set up at login; the private key is cached in IndexedDB so
// reloads stay unlocked, and recovered from the password on a fresh device. If any
// part is unavailable, callers fall back to plaintext so messaging never breaks.
import { supabaseClient } from "./client.js";
import { state, conversationKeys } from "./state.js";

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

// On conversation creation, make a fresh AES key and wrap it to every member's
// public key. Encrypt ONLY if every member already has a key, so nobody in the
// conversation is ever locked out (otherwise the chat stays plaintext).
export async function provisionConversationKey(conversationId, memberIds) {
  if (!encryptionReady()) return;
  try {
    const { data: profs } = await supabaseClient.from("profiles").select("id, public_key").in("id", memberIds);
    const members = profs || [];
    if (members.length < memberIds.length || members.some((p) => !p.public_key)) return;

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
    await supabaseClient.from("conversation_keys").insert(rows);
    conversationKeys.set(conversationId, convKey);
  } catch (e) {
    console.error("Could not set up conversation encryption:", e);
  }
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
