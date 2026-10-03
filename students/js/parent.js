// #parent: where a parent or guardian approves (or doesn't) their child's
// account (supabase-phase22.sql).
//
// They sign in with a one-time code sent to the email their child gave --
// which proves they control it -- read what Panalo keeps, and decide. They
// can also withdraw consent later, which deletes the child's account. Their
// own Panalo account (made by signing in with the code) is never entered:
// when they're done, they're signed out.
import { supabaseClient } from "../../src/client.js";
import { withBusy, showToast, authErrorText } from "../../src/util.js";
import { el } from "./ui.js";
import { emailParentCode, validCode } from "./age-gate.js";

const $ = (id) => document.getElementById(id);
const FORMS = ["parent-start-form", "parent-code-form", "parent-decide"];
const NOTICE_VERSION = "2026-10";
let wired = false;
let showFormHook = () => {};
let email = "";

function message(text, ok = false) {
  const m = $("auth-message");
  m.dataset.tone = ok ? "ok" : "error";
  m.textContent = text || "";
}

function show(id) {
  showFormHook(id);
  FORMS.forEach((f) => ($(f).hidden = f !== id));
}

const year = new Date().getFullYear();

function requestCard(r) {
  const name = el("input", { type: "text", autocomplete: "name", maxlength: "120", required: "" });
  const relation = el("select", {}, [el("option", { value: "parent", text: "Parent" }), el("option", { value: "guardian", text: "Legal guardian" })]);
  const born = el("input", { type: "number", inputmode: "numeric", min: String(year - 120), max: String(year - 18), placeholder: "e.g. 1980", required: "" });
  const DECLARATIONS = [
    "I am this child's parent or legal guardian.",
    "I am 18 or older.",
    "I've read what Panalo keeps and who can see it, and I agree to it for my child.",
  ];
  const checks = DECLARATIONS.map(() => el("input", { type: "checkbox" }));
  const approve = el("button", { type: "button", class: "btn btn-primary", text: `Yes, @${r.child_username} may use Panalo` });
  const decline = el("button", { type: "button", class: "btn btn-ghost", text: "No" });
  const decide = (yes, btn) =>
    withBusy(btn, "Saving…", async () => {
      if (yes) {
        if (name.value.trim().length < 2) return message("Enter your full name.");
        if (!born.value) return message("Enter the year you were born.");
        if (checks.some((c) => !c.checked)) return message("Tick all three to agree.");
      }
      const { error } = await supabaseClient.rpc("decide_parent_consent", {
        p_child: r.child_id, p_approve: yes, p_parent_name: name.value.trim() || null, p_relation: relation.value, p_parent_birth_year: born.value ? Number(born.value) : null, p_notice_version: NOTICE_VERSION,
      });
      if (error) return message(error.message || "Couldn't save that.");
      message(yes ? `Thank you. @${r.child_username} can now use Panalo.` : `Saved. @${r.child_username} can't use Panalo unless you change your mind.`, true);
      load();
    });
  approve.addEventListener("click", () => decide(true, approve));
  decline.addEventListener("click", () => decide(false, decline));

  if (r.consent === "approved") {
    const withdraw = el("button", { type: "button", class: "btn btn-danger btn-sm", text: `Withdraw consent and delete @${r.child_username}'s account` });
    withdraw.addEventListener("click", () => {
      if (!confirm(`Delete @${r.child_username}'s account and everything in it? This can't be undone.`)) return;
      withBusy(withdraw, "Deleting…", async () => {
        const { error } = await supabaseClient.rpc("withdraw_parent_consent", { p_child: r.child_id });
        if (error) return message(error.message || "Couldn't do that.");
        message(`Consent withdrawn. @${r.child_username}'s account is deleted.`, true);
        load();
      });
    });
    return el("section", { class: "parent-card approved" }, [
      el("h2", { text: `@${r.child_username} · ${r.child_age}` }),
      el("p", { class: "muted", text: "You've agreed. You can withdraw at any time; their account is then deleted." }),
      withdraw,
    ]);
  }

  return el("section", { class: "parent-card" }, [
    el("h2", { text: `@${r.child_username} · ${r.child_age}` }),
    el("p", { class: "muted", text: r.consent === "declined" ? "You said no. You can change your mind here." : "Asked you to agree to their Panalo account." }),
    el("details", { class: "parent-notice", open: "" }, [
      el("summary", { text: "What Panalo keeps about your child" }),
      el("ul", {}, [
        el("li", { text: "Their email (never shown to anyone), username, and month and year of birth." }),
        el("li", { text: "Messages and chat files — encrypted on their device; the server can't read them." }),
        el("li", { text: "Study tasks, focus sessions, calendar, goals and files they keep in their archive — visible only to them." }),
        el("li", { text: "No ads, no tracking, no selling data, no feed. Nothing is sent to an AI service." }),
        el("li", { text: "They, or you, can delete everything at any time." }),
      ]),
      el("p", {}, [el("a", { href: "privacy.html", target: "_blank", rel: "noopener", text: "The full privacy notes" }), " · ", el("a", { href: "rules.html", target: "_blank", rel: "noopener", text: "Community rules" })]),
    ]),
    el("label", { class: "field" }, [el("span", { text: "Your full name" }), name]),
    el("div", { class: "field-row" }, [el("label", { class: "field" }, [el("span", { text: "You are their" }), relation]), el("label", { class: "field" }, [el("span", { text: "Year you were born" }), born])]),
    ...checks.map((c, i) => el("label", { class: "check" }, [c, el("span", { text: DECLARATIONS[i] })])),
    el("div", { class: "chips" }, [approve, decline]),
  ]);
}

async function load() {
  const box = $("parent-requests");
  box.replaceChildren(el("div", { class: "loading-line" }));
  const { data, error } = await supabaseClient.rpc("my_children_requests");
  if (error) {
    box.replaceChildren(el("p", { class: "muted", text: "Couldn't load requests. Try again." }));
    return;
  }
  const mine = (await supabaseClient.auth.getUser()).data.user?.email || email;
  if (!data?.length) {
    box.replaceChildren(el("p", { class: "muted", text: `No requests for ${mine}. Ask your child to enter exactly this address on their "Ask a parent" screen.` }));
    return;
  }
  if (data.some((r) => !r.verified)) {
    box.replaceChildren(el("p", { class: "muted", text: "For your child's safety, sign in again with a fresh code to decide." }));
    return;
  }
  box.replaceChildren(...data.map(requestCard));
}

function wire() {
  if (wired) return;
  wired = true;
  $("parent-start-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("parent-send"), "Sending…", async () => {
      email = $("parent-email").value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return message("Enter your email address.");
      const { error } = await emailParentCode(email);
      if (error) return message(authErrorText(error));
      $("parent-code-email-field").hidden = true;
      $("parent-code-lead").textContent = `We sent a code to ${email}. Check spam too.`;
      show("parent-code-form");
      message("");
    });
  });
  $("parent-have-code").addEventListener("click", () => {
    email = $("parent-email").value.trim().toLowerCase();
    $("parent-code-email").value = email;
    $("parent-code-email-field").hidden = false;
    $("parent-code-lead").textContent = "Enter the email address the code was sent to, and the code.";
    show("parent-code-form");
  });
  $("parent-code-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("parent-verify"), "Checking…", async () => {
      if (!$("parent-code-email-field").hidden) email = $("parent-code-email").value.trim().toLowerCase();
      const token = $("parent-code").value.trim();
      if (!email) return message("Enter your email address.");
      if (!validCode(token)) return message("Enter the code from the email.");
      let { error } = await supabaseClient.auth.verifyOtp({ email, token, type: "email" });
      // A brand-new address gets the sign-up email; its code is a "signup" one.
      if (error) ({ error } = await supabaseClient.auth.verifyOtp({ email, token, type: "signup" }));
      if (error) return message("That code didn't work. Check it, or ask for a new one.");
      message("");
      show("parent-decide");
      load();
    });
  });
  $("parent-done").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    showToast("Signed out. Thank you.", "success");
    location.hash = "#top";
    location.reload();
  });
}

/** Show the parent flow in the crossing. */
export async function showParent({ show: showForm }) {
  showFormHook = (id) => showForm(id);
  wire();
  message("");
  // Already signed in with a fresh code (e.g. a reload): go straight on.
  const { data } = await supabaseClient.auth.getSession();
  const amr = (() => {
    try {
      return JSON.parse(atob(data.session?.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/") || "")).amr || [];
    } catch {
      return [];
    }
  })();
  const fresh = amr.some((m) => ["otp", "magiclink", "email/signup"].includes(m.method) && m.timestamp > Date.now() / 1000 - 3600);
  if (fresh) {
    show("parent-decide");
    load();
    return;
  }
  if (data.session) message("Someone is signed in on this device. Continuing signs them out here.", true);
  show("parent-start-form");
}
