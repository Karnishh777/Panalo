// Why a chat can't be read on this device, in words.
//
// Pure, so it is tested in Node (tests/keystatus.test.mjs).
//
// Every unreadable message used to say "🔒 Encrypted — unlock to read". That
// is only true for one of three situations, and the other two were the
// common ones: people who WERE unlocked saw it, looked for something to
// unlock, found nothing, and reasonably concluded the app was broken.
//
//   LOCKED   this device has not been given the password yet. Unlocking
//            fixes it.
//   MISSING  this account holds no copy of the chat's key -- it was added
//            before it had set up encryption, or the copy was never written.
//   STALE    this account holds a copy, but wrapped to a key pair it no longer
//            has: a password reset on a device that did not have the old key
//            makes a new pair, and every copy made for the old one becomes
//            unopenable.
//
// MISSING and STALE are both fixed the same way: someone who can read the
// chat shares the key again (src/keyshare.js). Nothing on this device alone
// can recover it -- that is what the encryption is for.
export const KEY_PROBLEM = Object.freeze({ LOCKED: "locked", MISSING: "missing", STALE: "stale" });

const PREVIEW = {
  [KEY_PROBLEM.LOCKED]: "🔒 Encrypted — unlock to read",
  [KEY_PROBLEM.MISSING]: "🔒 Encrypted — you don't have this chat's key",
  [KEY_PROBLEM.STALE]: "🔒 Encrypted to your old key",
};

const EXPLAIN = {
  [KEY_PROBLEM.LOCKED]: "Your messages are locked on this device. Enter your password to read them.",
  [KEY_PROBLEM.MISSING]:
    "Your account doesn't have this chat's key, so its messages can't be opened here. Anyone in the chat can share it with you.",
  [KEY_PROBLEM.STALE]:
    "These messages were encrypted to the key your account had before a password reset, so they can't be opened with the new one. Anyone in the chat can share the key with you again.",
};

// One line, for a message bubble or the chat list.
export function lockedPreview(problem) {
  return PREVIEW[problem] || PREVIEW[KEY_PROBLEM.MISSING];
}

// The sentence shown above an unreadable chat.
export function lockedExplanation(problem) {
  return EXPLAIN[problem] || EXPLAIN[KEY_PROBLEM.MISSING];
}

// Whether asking someone else in the chat can fix it. A locked device only
// needs its own password.
export function canAskForKey(problem) {
  return problem === KEY_PROBLEM.MISSING || problem === KEY_PROBLEM.STALE;
}

// Asking for the key is a message in the chat, so everyone in it sees who is
// asking and one of them chooses to answer. It is the only plaintext message
// an encrypted chat will carry, and it holds no text anyone typed.
export const KEY_REQUEST_MARKER = "[[keyrequest]]";

export function isKeyRequest(text) {
  return typeof text === "string" && text.trim() === KEY_REQUEST_MARKER;
}

// Short form for a chat-list preview or a notification.
export function describeKeyRequest(text) {
  return isKeyRequest(text) ? "🔑 Asked for this chat's key" : text;
}
