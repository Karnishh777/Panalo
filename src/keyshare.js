// Getting a chat's key back when your account can't open it.
//
// Before this there was no way back at all. A password reset on a device
// without the old key gave the account a new key pair; every chat key
// wrapped to the old one became unopenable; the chats showed "unlock to
// read" with nothing to unlock; and sendpolicy.js (correctly) refused to
// send into them. The chat was simply dead for that person.
//
// The key still exists -- everyone else in the chat holds it. So:
//
//   1. The person who can't read taps "Ask for the key". Their unopenable
//      copy is deleted (the primary key would otherwise refuse a new one) and
//      a key-request message goes into the chat.
//   2. Anyone who can read the chat sees "<name> can't read this chat" with a
//      "Share key" button, and chooses to press it.
//   3. That wraps the chat key to the requester's CURRENT public key.
//
// Deliberately a person's choice, not automatic. Wrapping to whatever public
// key the server hands out is only as trustworthy as the server; doing it
// silently would let anyone who can edit the profiles table swap a key in
// and receive every chat's history. A visible request that someone chooses
// to answer is the same trust WhatsApp asks for with "security code
// changed" -- and it shows everyone in the chat that it happened.
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { el, showToast } from "./util.js";
import { icon } from "./icons.js";
import { getConversationKey, keyProblemFor, forgetConversationKey } from "./encryption.js";
import { KEY_PROBLEM, KEY_REQUEST_MARKER, lockedExplanation, canAskForKey } from "./keystatus.js";

async function requestKey(conversationId) {
  const me = state.currentUser.id;
  if (keyProblemFor(conversationId) === KEY_PROBLEM.STALE) {
    const { error } = await supabaseClient
      .from("conversation_keys")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("user_id", me);
    if (error) return false;
  }
  forgetConversationKey(conversationId);
  const { error } = await supabaseClient.from("messages").insert([{
    conversation_id: conversationId,
    user_id: me,
    username: state.currentUsername,
    content: KEY_REQUEST_MARKER,
    iv: null,
    client_id: crypto.randomUUID(),
  }]);
  return !error;
}

async function shareKey(conversationId, userId) {
  const key = await getConversationKey(conversationId);
  if (!key) return "no-key";
  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("public_key")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.public_key) return "no-public-key";
  try {
    const pub = await window.PanaloCrypto.importPublicKey(profile.public_key);
    const wrapped = await window.PanaloCrypto.wrapConversationKey(key, pub);
    const { error } = await supabaseClient
      .from("conversation_keys")
      .insert([{ conversation_id: conversationId, user_id: userId, wrapped_key: wrapped }]);
    if (!error) return "shared";
    return /duplicate/i.test(error.message) ? "already" : "failed";
  } catch {
    return "failed";
  }
}

const SHARE_RESULT = {
  shared: (name) => [`Shared. ${name} can read this chat now.`, "success"],
  already: (name) => [`${name} already has the key.`, ""],
  "no-key": () => ["You can't share a key you don't have.", ""],
  "no-public-key": (name) => [`${name} hasn't set up encryption yet.`, ""],
  failed: () => ["Couldn't share the key. Try again.", ""],
};

/**
 * The line shown in place of a key-request message.
 * @param {{ msg: object, isMine: boolean, isMember: boolean }} args
 */
export function renderKeyRequest({ msg, isMine, isMember }) {
  const name = msg.username || "Someone";
  const text = isMine
    ? "You asked for this chat's key. Reopen the chat once someone has shared it."
    : `${name} can't read this chat and asked for its key.`;
  const children = [el("span", { class: "key-request-icon" }, [icon("lock", 14)]), el("span", { text })];
  if (!isMine && isMember) {
    const button = el("button", {
      class: "key-request-share",
      type: "button",
      text: "Share key",
      onClick: async () => {
        button.disabled = true;
        const result = await shareKey(msg.conversation_id, msg.user_id);
        const [message, kind] = SHARE_RESULT[result](name);
        showToast(message, kind);
        if (result === "shared" || result === "already") button.textContent = "Shared";
        else button.disabled = false;
      },
    });
    children.push(button);
  }
  return el("div", { class: "key-request" }, children);
}

/**
 * Explain why the open chat can't be read, and offer the fix. Returns null
 * when the chat is readable.
 * @param {string} conversationId
 * @param {{ onRetry: () => void }} actions
 */
export async function renderKeyBanner(conversationId, { onRetry }) {
  if (!window.PanaloCrypto) return null;
  if (await getConversationKey(conversationId)) return null;

  // No key and no encrypted history means a plaintext chat, which is not a
  // problem to explain. Only complain where there is something unreadable.
  const { count } = await supabaseClient
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .not("iv", "is", null);
  if (!count) return null;

  const problem = keyProblemFor(conversationId);
  const actions = [];
  if (problem === KEY_PROBLEM.LOCKED) {
    actions.push(el("button", { class: "key-banner-btn", type: "button", text: "Unlock", onClick: () => location.reload() }));
  } else if (canAskForKey(problem)) {
    const ask = el("button", {
      class: "key-banner-btn",
      type: "button",
      text: "Ask for the key",
      onClick: async () => {
        ask.disabled = true;
        if (await requestKey(conversationId)) {
          ask.textContent = "Asked";
          showToast("Asked. Anyone in the chat can share the key with you.", "success");
        } else {
          ask.disabled = false;
          showToast("Couldn't send the request. Try again.");
        }
      },
    });
    actions.push(ask, el("button", { class: "key-banner-btn secondary", type: "button", text: "Check again", onClick: onRetry }));
  }

  return el("div", { class: "key-banner", role: "status" }, [
    el("span", { class: "key-banner-icon", "aria-hidden": "true" }, [icon("lock", 18)]),
    el("div", { class: "key-banner-body" }, [
      el("p", { class: "key-banner-text", text: lockedExplanation(problem) }),
      actions.length ? el("div", { class: "key-banner-actions" }, actions) : null,
    ]),
  ]);
}
