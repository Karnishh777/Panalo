// Shared mutable app state. Modules read and write these fields directly, which
// keeps a single source of truth without a heavyweight store.
export const state = {
  currentUser: null,
  currentUsername: "",
  myProfile: null, // own profiles row: { username, bio, avatar_url }
  currentConversationId: null,
  currentConversation: null, // the full conversation row (for theme, etc.)
  realtimeChannel: null,

  // signup / unlock flow
  pendingSignupEmail: "",
  pendingSignupPassword: "",
  pendingUnlockSession: null,
  // Set only when a login succeeded but the stored key was protected with a
  // DIFFERENT password. Held just long enough to re-protect the key once the
  // user supplies the old one, then cleared.
  pendingRewrapPassword: "",

  // encryption (see crypto.js / encryption.js)
  myPrivateKey: null, // CryptoKey (RSA) used to unwrap conversation keys
  myPublicKeyB64: null,

  // message pagination
  oldestLoadedAt: null,
  hasMoreOlderMessages: false,
  loadingOlder: false,
};

// conversationId -> AES CryptoKey (decrypted, in-memory only)
export const conversationKeys = new Map();
