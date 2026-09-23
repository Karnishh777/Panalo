// @mentions.
//
// Mentions cannot be resolved on the server: message text is ciphertext, so
// nothing there can tell who was named. They are found on the device, after
// decryption — which is also why a mention cannot create a database row, a
// server-side badge count, or a push notification from the backend.
//
// What that buys is simplicity: no schema, no migration, no extra table to
// keep in step with the message it refers to. What it costs is that a mention
// only reaches you while the app is open somewhere. That is the same limit
// the rest of the alerting already has — there is no web-push (see
// LIMITATIONS.md) — so mentions are no worse off than any other notification.
//
// Everything here is a pure function over text, which is what makes it
// testable without a DOM or a network.

// A username is the shape the signup form allows: letters, digits,
// underscore, dot, hyphen.
const MENTION_PATTERN = /@([A-Za-z0-9_.-]{1,32})/g;

// Trailing punctuation belongs to the sentence, not the name: "@ada." should
// mention ada, and "@ada..." should not mention "ada..".
function trimName(raw) {
  return raw.replace(/[.\-_]+$/, "");
}

// Every @name in a message, lowercased and de-duplicated. Order carries no
// meaning, so a Set is the honest shape.
export function extractMentions(text) {
  const found = new Set();
  for (const m of String(text || "").matchAll(MENTION_PATTERN)) {
    const name = trimName(m[1]);
    if (name) found.add(name.toLowerCase());
  }
  return [...found];
}

// Does this message name me?
//
// Case-insensitive, because nobody types a username with the capitalisation
// the other person chose. Being silently un-notified for typing "@ada"
// instead of "@Ada" would make the whole feature untrustworthy.
export function mentionsUser(text, username) {
  if (!username) return false;
  return extractMentions(text).includes(String(username).toLowerCase());
}

// Split text into plain and mention pieces, so a renderer can build nodes
// without putting message text anywhere near innerHTML.
//
// `known` is the usernames actually in this conversation. A mention of
// someone who is not here stays ordinary text: highlighting "@everyone" or an
// email address as though it were a person would promise something the app
// does not do.
export function splitMentions(text, known = []) {
  const source = String(text || "");
  const present = new Set([...known].filter(Boolean).map((n) => String(n).toLowerCase()));
  const parts = [];
  let last = 0;

  for (const m of source.matchAll(MENTION_PATTERN)) {
    const raw = trimName(m[1]);
    const name = raw.toLowerCase();
    if (!raw || !present.has(name)) continue;

    const start = m.index;
    const end = start + 1 + raw.length; // "@" plus the trimmed name
    if (start > last) parts.push({ type: "text", value: source.slice(last, start) });
    parts.push({ type: "mention", value: source.slice(start, end), name });
    last = end;
  }

  if (last < source.length) parts.push({ type: "text", value: source.slice(last) });
  return parts.length ? parts : [{ type: "text", value: source }];
}

// The word at the caret, if it looks like a mention being typed. Returns null
// when it isn't, so the composer doesn't have to re-implement the rule to
// decide whether to show a picker.
export function mentionQueryAt(text, caret) {
  const upto = String(text || "").slice(0, caret);
  const m = /(^|\s)@([A-Za-z0-9_.-]{0,32})$/.exec(upto);
  if (!m) return null;
  return { query: m[2].toLowerCase(), start: caret - m[2].length - 1 };
}

// Replace the half-typed mention at `start` with a complete one. Returns where
// the caret should land too: leaving it behind the inserted name is the kind
// of small wrongness that makes a feature feel broken.
export function applyMention(text, start, caret, username) {
  const source = String(text || "");
  const rest = source.slice(caret);
  // A trailing space is what lets you keep typing, but adding one when the
  // line already continues with whitespace leaves a double space behind the
  // name -- which is exactly where nobody looks for it.
  const inserted = `@${username}` + (/^\s/.test(rest) ? "" : " ");
  return {
    text: source.slice(0, start) + inserted + rest,
    caret: start + inserted.length,
  };
}
