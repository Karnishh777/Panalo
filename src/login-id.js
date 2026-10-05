// Log in with an email or a username (supabase-phase25.sql).
//
// Supabase signs in by email. For a username, login_email() hands back the
// account's email -- but only with the right password, so it can't be used
// to look up anyone's address. Then the normal email sign-in runs, with the
// bot check and everything else, exactly as before.
import { supabaseClient } from "./client.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Whether what was typed is an email address (otherwise it's a username). */
export const looksLikeEmail = (s) => EMAIL_RE.test(String(s || "").trim());

/**
 * The email to sign in with: what was typed, if it's an email; otherwise the
 * email of that username, if the password is right. Resolves to
 * `{ email }` or `{ error }` (a sentence for the person).
 */
export async function loginEmail(identifier, password) {
  const id = String(identifier || "").trim();
  if (!id) return { error: "Enter your email or username." };
  if (looksLikeEmail(id)) return { email: id };
  const { data, error } = await supabaseClient.rpc("login_email", { p_username: id, p_password: password });
  if (error) {
    if (/too many/i.test(error.message || "")) return { error: error.message };
    if (/function|does not exist|schema cache/i.test(error.message || "")) return { error: "Logging in with a username isn't available yet. Use your email." };
    return { error: "Couldn't check that username. Try again, or use your email." };
  }
  if (!data) return { error: "That username and password don't match." };
  return { email: data };
}
