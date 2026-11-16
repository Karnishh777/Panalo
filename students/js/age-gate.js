// Before anyone enters: how old are they, and if 13 to 17, has a parent or
// guardian agreed? (supabase-phase22.sql; the database also refuses to store
// anything for a student still waiting, so this screen is the explanation,
// not the lock.)
//
//   no date of birth yet → ask once (taken from sign-up when it was given)
//   under 13            → Panalo isn't for you yet; offer to delete
//   13–17, no consent   → name a parent; we email them; wait (and check)
//   otherwise           → in
import { supabaseClient } from "../../src/client.js";
import { withBusy, showToast } from "../../src/util.js";
import { captcha } from "../../src/captcha.js";
import { deleteAllMyFiles, nudgeErasure } from "../../src/filestore.js";

const $ = (id) => document.getElementById(id);
const FORMS = ["age-form", "guardian-form", "young-form"];
const PARENT_LINK = () => `${location.origin}${location.pathname}#parent`;

let showFormHook = () => {};
let signOutHook = async () => {};
let wired = false;
let pass = null; // resolves when the gate opens
let pollTimer = null;
let retryTimer = 0;

function message(text, ok = false) {
  const m = $("auth-message");
  m.dataset.tone = ok ? "ok" : "error";
  m.textContent = text || "";
}

async function status() {
  const { data, error } = await supabaseClient.rpc("my_age_status");
  // Only a database without phase 22 has no such function; any other error
  // keeps the gate shut (it fails closed, phase 40).
  if (error) return /PGRST202|42883|Could not find the function/.test(`${error.code} ${error.message}`) ? { unavailable: true, error } : { failed: true, error };
  return data?.[0] || { needs_birth: true };
}

// Pick the code length up from the email: 6 to 10 digits, by project setting.
export const validCode = (code) => /^\d{6,10}$/.test(code);

// Ask Supabase to email someone a one-time code (and the #parent link,
// through the Magic Link template). Creates their account if they have none.
export async function emailParentCode(email) {
  const username = `guardian_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  return supabaseClient.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, data: { username, guardian: true }, emailRedirectTo: PARENT_LINK(), ...(await captcha()) },
  });
}

async function deleteAccount() {
  if (!confirm("Delete this account and everything in it? This can't be undone.")) return;
  await deleteAllMyFiles().catch(() => 0);
  const { error } = await supabaseClient.rpc("delete_my_account");
  if (error) return message("Couldn't delete it. Try again.");
  nudgeErasure();
  await signOutHook();
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

function wire() {
  if (wired) return;
  wired = true;
  $("age-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("age-submit"), "Saving…", async () => {
      const y = Number($("age-year").value), m = Number($("age-month").value);
      if (!y || !m) return message("Choose a month and enter the year.");
      const { error } = await supabaseClient.rpc("set_my_birth", { p_year: y, p_month: m });
      if (error) return message(error.message || "Couldn't save that.");
      run();
    });
  });
  $("guardian-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("guardian-submit"), "Sending…", async () => {
      const email = $("guardian-email").value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return message("Enter your parent's email address.");
      const { error } = await supabaseClient.rpc("request_parent_consent", { p_parent_email: email });
      if (error) return message(error.message || "Couldn't send that.");
      const sent = await emailParentCode(email);
      if (sent.error) message(/rate|seconds/i.test(sent.error.message) ? "Saved. The email can't go out again for a minute — or send them the link below." : "Saved, but the email didn't go out. Send them the link below.");
      else message(`Sent to ${email}.`, true);
      run();
    });
  });
  $("guardian-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(PARENT_LINK());
      showToast("Link copied. Send it to your parent.", "success");
    } catch {
      showToast(PARENT_LINK());
    }
  });
  $("guardian-check").addEventListener("click", () => withBusy($("guardian-check"), "Checking…", () => run(true)));
  $("guardian-signout").addEventListener("click", () => {
    stopPolling();
    signOutHook();
  });
  $("guardian-delete").addEventListener("click", deleteAccount);
  $("young-delete").addEventListener("click", deleteAccount);
}

async function run(manual = false) {
  const st = await status();
  if (st.unavailable) {
    // The database hasn't had phase 22: nothing to check.
    return open();
  }
  if (st.failed) {
    // Couldn't check (offline, a server hiccup): stay at the door and try
    // again shortly, rather than letting anyone in unchecked.
    showFormHook("age-form");
    message("We couldn't check your account just now. Trying again…");
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => run(), 8000);
    return;
  }
  if (st.needs_birth) {
    // Given at sign-up? Then it's already ours to save.
    const meta = (await supabaseClient.auth.getUser()).data.user?.user_metadata || {};
    if (meta.birth_year && meta.birth_month) {
      const { error } = await supabaseClient.rpc("set_my_birth", { p_year: Number(meta.birth_year), p_month: Number(meta.birth_month) });
      if (!error) return run();
    }
    showFormHook("age-form");
    return;
  }
  if (st.under13) {
    showFormHook("young-form");
    return;
  }
  if (st.minor && st.consent !== "approved") {
    showFormHook("guardian-form");
    $("guardian-link-text").textContent = PARENT_LINK().replace(/^https?:\/\//, "");
    // After a "no" nobody is waiting: only the parent who said it can change
    // it (phase 40), so the email is locked to theirs and the button only
    // sends them the link again.
    const declined = st.consent === "declined";
    const waiting = Boolean(st.parent_email) && !declined;
    $("guardian-wait").hidden = !waiting;
    if (declined && st.parent_email) $("guardian-email").value = st.parent_email;
    else if (st.parent_email && !$("guardian-email").value) $("guardian-email").value = st.parent_email;
    $("guardian-submit").textContent = declined ? "Email them the link again" : waiting ? "Send again" : "Send to my parent";
    $("guardian-email").readOnly = declined;
    $("guardian-lead").textContent = declined
      ? "Your parent or guardian said no for now. Only they can change that: they can open the link in their email again and say yes. If something's wrong, write to us from the Contact page."
      : `Because you're ${st.age}, a parent or legal guardian has to agree before you can use Panalo. Enter their email: we'll send them a code and a link.`;
    $("guardian-status").textContent = waiting ? `Waiting for ${st.parent_email} to say yes.` : "";
    if (manual && waiting) message("Not yet. It updates by itself once they've said yes.");
    if (!pollTimer) pollTimer = setInterval(() => document.visibilityState === "visible" && run(), 15000);
    return;
  }
  open();
}

function open() {
  stopPolling();
  clearTimeout(retryTimer);
  FORMS.forEach((f) => ($(f).hidden = true));
  message("");
  const p = pass;
  pass = null;
  p?.();
}

/**
 * Resolves once this account may enter; until then shows the right screen.
 * `show(id)` shows a form in the crossing; `signOut()` ends the session.
 */
export function ageGate({ show, signOut }) {
  showFormHook = show;
  signOutHook = signOut;
  wire();
  return new Promise((resolve) => {
    pass = resolve;
    run();
  });
}
