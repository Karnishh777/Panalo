// Panalo Chat's side of age and a parent's consent (supabase-phase22.sql).
//
// The two apps share accounts. Asking a parent happens in Panalo Students
// (students/js/age-gate.js, students/js/parent.js); Chat checks before it
// opens, asks for a date of birth once if it has none, and otherwise points
// to Students. The database refuses to store anything for a student still
// waiting, whatever the app.
import { supabaseClient } from "./client.js";
import { el } from "./util.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function status() {
  const { data, error } = await supabaseClient.rpc("my_age_status");
  if (error) return null; // not set up here: nothing to check
  return data?.[0] || null;
}

function wall(children) {
  const node = el("div", { class: "age-wall", role: "dialog", "aria-modal": "true", "aria-labelledby": "age-wall-title" }, [el("div", { class: "age-wall-card" }, children)]);
  document.body.append(node);
  return node;
}

function askBirth() {
  return new Promise((resolve) => {
    const month = el("select", { "aria-label": "Month of birth", required: "" }, [el("option", { value: "", text: "Month", disabled: "", selected: "" }), ...MONTHS.map((m, i) => el("option", { value: String(i + 1), text: m }))]);
    const year = el("input", { type: "number", inputmode: "numeric", placeholder: "Year", "aria-label": "Year of birth" });
    const msg = el("p", { class: "age-wall-msg", role: "alert" });
    const go = el("button", { type: "button", class: "btn btn-primary btn-block", text: "Continue" });
    const node = wall([
      el("h2", { id: "age-wall-title", text: "When were you born?" }),
      el("p", { text: "The law asks us to know whether you're under 18. Only the month and year, never shown to anyone, and it can't be changed later." }),
      el("div", { class: "age-wall-row" }, [month, year]),
      msg,
      go,
    ]);
    go.addEventListener("click", async () => {
      if (!month.value || !year.value) return void (msg.textContent = "Choose a month and enter the year.");
      go.disabled = true;
      const { error } = await supabaseClient.rpc("set_my_birth", { p_year: Number(year.value), p_month: Number(month.value) });
      go.disabled = false;
      if (error) return void (msg.textContent = error.message || "Couldn't save that.");
      node.remove();
      resolve();
    });
  });
}

function blocked(st, signOut) {
  const under13 = st.under13;
  wall([
    el("h2", { id: "age-wall-title", text: under13 ? "Panalo is for people 13 and over." : "A parent or guardian needs to say yes." }),
    el("p", { text: under13 ? "We'd love to see you when you're 13. Until then we can't keep an account for you." : st.parent_email ? `We're waiting for ${st.parent_email}. Finish in Panalo Students, where you can send them the link again.` : "Because you're under 18, a parent or legal guardian has to agree first. Panalo Students walks you through it." }),
    under13 ? null : el("a", { class: "btn btn-primary btn-block", href: "students/#login", text: "Continue in Panalo Students" }),
    el("button", { type: "button", class: "btn btn-ghost btn-block", text: "Sign out", onClick: () => signOut() }),
  ].filter(Boolean));
}

/** Resolves true when this account may use Chat; otherwise shows why and resolves false. */
export async function chatAgeGate(session, signOut) {
  let st = await status();
  if (!st) return true;
  if (st.needs_birth) {
    const meta = session.user.user_metadata || {};
    const fromSignup = meta.birth_year && meta.birth_month
      ? await supabaseClient.rpc("set_my_birth", { p_year: Number(meta.birth_year), p_month: Number(meta.birth_month) })
      : { error: true };
    if (fromSignup.error) await askBirth();
    st = await status();
    if (!st) return true;
  }
  if (st.under13 || (st.minor && st.consent !== "approved")) {
    blocked(st, signOut);
    return false;
  }
  return true;
}

/** Whole years from a month and year of birth, as the database counts them. */
export function ageFrom(year, month, now = new Date()) {
  return now.getFullYear() - year - (now.getMonth() + 1 <= month ? 1 : 0);
}
