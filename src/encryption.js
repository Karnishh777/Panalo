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

  const [{ data: keyRow }, { data: profileRow }] = await Promise.all([
    supabaseClient.from("user_keys").select("enc_private_key, key_salt, key_iv").eq("user_id", state.currentUser.id).maybeSingle(),
    supabaseClient.from("profiles").select("public_key").eq("id", state.currentUser.id).maybeSingle(),
  ]);

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
        { encPrivateKey: keyRow.enc_private_key, keySalt: keyRow.key_salt, keyIv: keyRow.key_iv },
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

    const { error: keyError } = await supabaseClient.from("user_keys").upsert({
      user_id: state.currentUser.id,
      enc_private_key: stored.encPrivateKey,
      key_salt: stored.keySalt,
      key_iv: stored.keyIv,
    });
    if (keyError) throw keyError;

    state.myPrivateKey = kp.privateKey;
    await idbSetKey(state.currentUser.id, state.myPrivateKey);
    return "ready";
  } catch (e) {
    console.error("Key setup failed:", e);
    return "setup-failed";
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
