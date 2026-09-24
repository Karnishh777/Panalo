// Whether a message may leave this device, and in what form.
//
// sendMessage() and forwardMessage() used to fall back to plaintext whenever
// they had no conversation key. That was meant for chats that were never
// encrypted, but it applied just as readily to chats that ARE encrypted and
// where this device merely lacked its copy of the key -- a member added by
// someone whose own device had no key, a wrap that failed inside a silent
// catch, a key row deleted from under you. The message then went out in the
// clear into a chat everyone believed was encrypted, and nothing said so.
// Commit 577baf7 closed one road into that state (a login that could not
// unwrap the private key); this rule closes the rest by deciding on facts
// rather than on the absence of a key.
//
// Pure on purpose: it is the one decision in the send path that must never
// quietly change, so it is tested in isolation (tests/sendpolicy.test.mjs).

export const SEND = Object.freeze({
  ENCRYPT: "encrypt",
  PLAINTEXT: "plaintext",
  REFUSE: "refuse",
});

/**
 * @param {{
 *   hasKey?: boolean,              this device holds the conversation key
 *   cryptoSupported?: boolean,     the browser has Web Crypto at all
 *   hasPrivateKey?: boolean,       this device's private key is unlocked
 *   missingMemberKeys?: boolean,   some member has never set up encryption
 *   hasEncryptedHistory?: boolean, the chat already holds encrypted messages
 * }} facts
 * @returns {"encrypt" | "plaintext" | "refuse"}
 */
// Every default leans toward refusing: a fact the caller forgot to pass must
// never be what lets plaintext out.
export function sendMode({
  hasKey = false,
  cryptoSupported = true,
  hasPrivateKey = false,
  missingMemberKeys = false,
  hasEncryptedHistory = false,
} = {}) {
  if (hasKey) return SEND.ENCRYPT;

  // A browser that cannot encrypt at all. Chats stay usable in plaintext,
  // which the app reports at login rather than hiding.
  if (!cryptoSupported) return SEND.PLAINTEXT;

  // Keys exist for this account but are locked on this device. Whether this
  // particular chat is encrypted cannot be known without them, so ask for
  // the unlock instead of guessing in the dangerous direction.
  if (!hasPrivateKey) return SEND.REFUSE;

  // Someone in the chat has never set up encryption, so no key could ever be
  // made that they could read -- the documented "this chat isn't encrypted"
  // case, and chat info says exactly that. Unless messages here were already
  // encrypted: then a key exists and this device is simply missing it.
  if (missingMemberKeys && !hasEncryptedHistory) return SEND.PLAINTEXT;

  return SEND.REFUSE;
}
