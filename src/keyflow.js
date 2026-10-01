// Key handling shared by both front ends (Panalo Chat in src/auth.js and
// Panalo Students in students/js/auth.js). They protect the same stored
// private keys, so the rules live here once rather than in two copies that
// can drift apart.
import { state } from "./state.js";
import { idbGetKey, rewrapPrivateKey, regenerateKeypair } from "./encryption.js";

/**
 * After a password reset: carry the private key over to the new password
 * if this device has it cached, otherwise make new keys (older encrypted
 * messages then can't be read). Call once Supabase has accepted the new
 * password and state.currentUser is set.
 * @returns {Promise<"moved"|"regenerated"|"move-failed"|"regenerate-failed">}
 */
export async function keysAfterPasswordReset(newPassword) {
  const cached = await idbGetKey(state.currentUser.id);
  if (cached) {
    state.myPrivateKey = cached;
    return (await rewrapPrivateKey(newPassword)) === "ready" ? "moved" : "move-failed";
  }
  return (await regenerateKeypair(newPassword)) === "ready" ? "regenerated" : "regenerate-failed";
}

/**
 * Whether this device holds the key, so a reset can keep messages readable.
 * Used to warn before the reset happens.
 */
export async function deviceHasKey(userId) {
  return !!(userId && (await idbGetKey(userId)));
}
