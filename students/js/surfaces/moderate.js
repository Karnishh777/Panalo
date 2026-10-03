// Moderation (#/moderate): reports, and what to do about them.
//
// Only moderators see the reports (supabase-phase20.sql checks every call).
// Anyone else who opens this address sees one thing: a field for the
// moderator passphrase, which is how the role is taken back if the
// moderator's account is ever deleted. It isn't linked from anywhere for
// people who aren't moderators.
//
// Deliberately calm: no effects, no colour beyond what carries meaning.
import { el, openSheet, confirmSheet, showToast, chipGroup, emptyState, reportError } from "../ui.js";
import { supabaseClient } from "../../../src/client.js";
import { refreshModeration } from "../moderation-badge.js";

const REASONS = { harassment: "Harassment", spam: "Spam", inappropriate: "Inappropriate", impersonation: "Impersonation", safety: "Someone may be at risk", other: "Other" };
const STATUS = { open: "Open", reviewing: "Reviewing", closed: "Closed" };
const FILTERS = [
  { id: "active", label: "Needs attention" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

let root;
let body;
let filter = "active";
let rows = [];

const when = (d) => new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const who = (name, fallback) => (name ? `@${name}` : fallback);

async function rpc(name, args) {
  const { data, error } = await supabaseClient.rpc(name, args);
  if (error) throw error;
  return data;
}

// ---- Not a moderator: the passphrase door ---------------------------------------------
function door(passphraseSet) {
  const input = el("input", { type: "password", id: "mod-pass", autocomplete: "off", required: "", minlength: "12" });
  const btn = el("button", { type: "submit", class: "btn btn-primary", text: "Continue" });
  const msg = el("p", { class: "field-hint", role: "status" });
  const form = el("form", { class: "mod-door panel", novalidate: "" }, [
    el("p", { class: "kicker", text: "Moderation" }),
    el("h1", { text: "Moderator access" }),
    el("p", { class: "muted", text: passphraseSet ? "Enter the moderator passphrase to make this account the moderator." : "No moderator passphrase has been set, so this account can't become a moderator here." }),
    passphraseSet ? el("label", { class: "field" }, [el("span", { text: "Passphrase" }), input]) : null,
    passphraseSet ? btn : null,
    msg,
  ]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input.value) return;
    btn.disabled = true;
    try {
      const ok = await rpc("moderation_claim", { p_passphrase: input.value });
      input.value = "";
      if (!ok) {
        msg.textContent = "That isn't the passphrase.";
        return;
      }
      showToast("This account is now the moderator.", "success");
      refreshModeration();
      load();
    } catch (err) {
      msg.textContent = err.code === "54000" ? err.message : "Couldn't check that. Try again.";
    } finally {
      btn.disabled = false;
    }
  });
  return form;
}

// ---- Reports -------------------------------------------------------------------------
function counts() {
  const c = { open: 0, reviewing: 0, closed: 0 };
  for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
  return c;
}

function shown() {
  if (filter === "all") return rows;
  if (filter === "closed") return rows.filter((r) => r.status === "closed");
  return rows.filter((r) => r.status !== "closed");
}

async function act(label, fn, done) {
  try {
    await fn();
    if (done) showToast(done, "success");
    await reload();
  } catch (e) {
    reportError(e, `Couldn't ${label}.`);
  }
}

function noteSheet({ title, lead, confirm, danger = false, choices = null }) {
  return new Promise((resolve) => {
    const note = el("textarea", { rows: "3", maxlength: "2000", placeholder: "Optional: what you found, what you did" });
    let choice = choices?.[1]?.id ?? null;
    const picker = choices ? chipGroup({ label: "How long", options: choices, value: choice, onChange: (v) => (choice = v) }).node : null;
    let answered = false;
    openSheet({
      title,
      lead,
      body: [picker, el("label", { class: "field" }, [el("span", { text: "Note (only moderators see it)" }), note])].filter(Boolean),
      actions: [
        { label: "Cancel", kind: "btn-quiet", onClick: () => { answered = true; resolve(null); } },
        { label: confirm, kind: danger ? "btn-danger" : "btn-primary", submit: true, onClick: () => { answered = true; resolve({ note: note.value.trim(), choice }); } },
      ],
      onClose: () => !answered && resolve(null),
    });
  });
}

const SUSPEND = [
  { id: "1", label: "1 day" },
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "forever", label: "Until lifted" },
];

function card(r) {
  const banned = r.reported_banned_until && new Date(r.reported_banned_until) > new Date();
  const actions = [];
  if (r.status === "open") actions.push(el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Start reviewing", onClick: () => act("update it", () => rpc("moderation_set_status", { p_report: r.id, p_status: "reviewing", p_note: null })) }));
  if (r.status !== "closed")
    actions.push(el("button", {
      type: "button", class: "btn btn-ghost btn-sm", text: "Close",
      onClick: async () => {
        const a = await noteSheet({ title: "Close this report", lead: "Closing says it's been dealt with. You can reopen it later.", confirm: "Close report" });
        if (a) act("close it", () => rpc("moderation_set_status", { p_report: r.id, p_status: "closed", p_note: a.note || null }), "Report closed.");
      },
    }));
  else actions.push(el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Reopen", onClick: () => act("reopen it", () => rpc("moderation_set_status", { p_report: r.id, p_status: "open", p_note: null })) }));
  if (r.message_exists)
    actions.push(el("button", {
      type: "button", class: "btn btn-ghost btn-sm", text: "Remove message",
      onClick: async () => {
        if (await confirmSheet({ title: "Remove this message for everyone?", lead: "It disappears from the conversation for every member. The report keeps its evidence.", confirm: "Remove", danger: true }))
          act("remove it", () => rpc("moderation_delete_message", { p_message: r.message_id, p_report: r.id }), "Message removed.");
      },
    }));
  if (r.reported_user_id && !banned)
    actions.push(el("button", {
      type: "button", class: "btn btn-danger btn-sm", text: "Suspend…",
      onClick: async () => {
        const a = await noteSheet({ title: `Suspend ${who(r.reported_username, "this account")}`, lead: "They're signed out everywhere within the hour and can't sign in until the suspension ends.", confirm: "Suspend", danger: true, choices: SUSPEND });
        if (a) act("suspend them", () => rpc("moderation_suspend", { p_user: r.reported_user_id, p_days: a.choice === "forever" ? null : Number(a.choice), p_report: r.id, p_note: a.note || null }), "Suspended.");
      },
    }));
  if (r.reported_user_id && banned)
    actions.push(el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Lift suspension", onClick: () => act("lift it", () => rpc("moderation_suspend", { p_user: r.reported_user_id, p_days: 0, p_report: r.id, p_note: null }), "Suspension lifted.") }));

  const until = banned ? (new Date(r.reported_banned_until).getFullYear() > new Date().getFullYear() + 50 ? "suspended until lifted" : `suspended until ${when(r.reported_banned_until)}`) : null;
  return el("article", { class: `mod-card status-${r.status}`, "data-report": r.id }, [
    el("header", { class: "mod-card-head" }, [
      el("span", { class: `mod-reason reason-${r.reason}`, text: /^\[Data request/.test(r.details || "") ? "Data request" : REASONS[r.reason] || r.reason }),
      /^\[Data request/.test(r.details || "") ? el("span", { class: "mod-due", text: `answer by ${when(new Date(new Date(r.created_at).getTime() + 15 * 86400000))}` }) : null,
      el("span", { class: `mod-status`, text: STATUS[r.status] }),
      el("time", { class: "faint", datetime: r.created_at, text: when(r.created_at) }),
    ]),
    el("p", { class: "mod-who" }, [
      el("b", { text: who(r.reported_username, r.reported_user_id ? "A deleted account" : "No one named") }),
      r.reported_report_count > 1 ? el("span", { class: "mod-repeat", text: `${r.reported_report_count} reports in total` }) : null,
      until ? el("span", { class: "mod-banned", text: until }) : null,
    ]),
    el("p", { class: "faint" }, [
      `Reported by ${who(r.reporter_username, "a deleted account")}`,
      r.conversation_id ? ` · in ${r.conversation_name ? `“${r.conversation_name}”` : r.conversation_type === "direct" ? "a direct chat" : "a conversation"}` : "",
      r.message_id && !r.message_exists ? " · message already removed" : "",
    ]),
    r.details ? el("p", { class: "mod-details", text: r.details }) : null,
    r.evidence ? el("blockquote", { class: "mod-evidence" }, [el("small", { text: "Message text, shared by the reporter" }), el("span", { text: r.evidence })]) : null,
    r.moderator_note ? el("p", { class: "mod-note" }, [el("small", { text: "Your note" }), el("span", { text: r.moderator_note })]) : null,
    el("div", { class: "mod-actions" }, actions),
  ]);
}

function renderReports() {
  const c = counts();
  const list = shown();
  body.replaceChildren(
    el("div", { class: "mod-stats" }, [
      el("div", {}, [el("b", { text: String(c.open) }), el("span", { text: "open" })]),
      el("div", {}, [el("b", { text: String(c.reviewing) }), el("span", { text: "reviewing" })]),
      el("div", {}, [el("b", { text: String(c.closed) }), el("span", { text: "closed" })]),
    ]),
    chipGroup({ label: "Show", options: FILTERS, value: filter, onChange: (v) => { filter = v; renderReports(); } }).node,
    list.length ? el("div", { class: "mod-list" }, list.map(card)) : emptyState(filter === "active" ? "Nothing needs you right now." : "No reports here.", filter === "active" ? "New reports appear here as soon as they're sent." : ""),
    settingsPanel(),
  );
}

function settingsPanel() {
  const pass = el("input", { type: "password", autocomplete: "new-password", minlength: "12", placeholder: "At least 12 characters" });
  const again = el("input", { type: "password", autocomplete: "new-password" });
  const btn = el("button", { type: "submit", class: "btn btn-ghost btn-sm", text: "Save passphrase" });
  const form = el("form", { class: "pw-form", novalidate: "" }, [
    el("label", { class: "field" }, [el("span", { text: "New passphrase" }), pass]),
    el("label", { class: "field" }, [el("span", { text: "Again" }), again]),
    btn,
  ]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (pass.value.length < 12) return showToast("Use at least 12 characters.");
    if (pass.value !== again.value) return showToast("The passphrases don't match.");
    btn.disabled = true;
    try {
      await rpc("moderation_set_passphrase", { p_passphrase: pass.value });
      pass.value = again.value = "";
      showToast("Passphrase saved. Keep it somewhere safe, away from this account.", "success");
    } catch (err) {
      reportError(err, "Couldn't save it.");
    } finally {
      btn.disabled = false;
    }
  });
  const history = el("div", { class: "mod-history" }, [el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Show what moderators did", onClick: (ev) => loadHistory(ev.currentTarget.parentElement) })]);
  return el("div", { class: "mod-side" }, [
    el("section", { class: "panel" }, [
      el("div", { class: "panel-head" }, [el("h2", { text: "If this account is ever deleted" })]),
      el("p", { class: "muted", text: "Set a passphrase. Then, from any new account, open this page and enter it to become the moderator again. Only a scrambled form of it is stored." }),
      form,
    ]),
    el("section", { class: "panel" }, [el("div", { class: "panel-head" }, [el("h2", { text: "History" })]), history]),
  ]);
}

async function loadHistory(box) {
  box.replaceChildren(el("div", { class: "loading-line" }));
  try {
    const items = await rpc("moderation_history");
    box.replaceChildren(
      items.length
        ? el("ol", { class: "mod-log" }, items.map((h) => el("li", {}, [el("time", { class: "faint", text: when(h.at) }), el("span", { text: ` ${who(h.moderator_username, "a moderator")} · ${h.action}${h.target_username ? ` · @${h.target_username}` : ""}${h.detail ? ` · ${h.detail}` : ""}` })])))
        : el("p", { class: "faint", text: "Nothing yet." })
    );
  } catch (e) {
    box.replaceChildren(el("p", { class: "faint", text: "Couldn't load the history." }));
  }
}

async function reload() {
  rows = (await rpc("moderation_reports", { p_status: null })) || [];
  renderReports();
  refreshModeration();
}

async function load() {
  body.replaceChildren(el("div", { class: "loading-line" }));
  let status;
  try {
    status = (await rpc("moderation_status"))?.[0];
  } catch (e) {
    body.replaceChildren(emptyState("Moderation isn't set up here.", "This Panalo's database doesn't have the moderation update (phase 20) yet."));
    return;
  }
  if (!status?.is_moderator) {
    body.replaceChildren(door(status?.passphrase_set));
    return;
  }
  try {
    await reload();
  } catch (e) {
    reportError(e, "Couldn't load reports.");
  }
}

export function mount(section) {
  root = el("div", { class: "moderate-page" });
  body = el("div", { class: "mod-body" });
  root.append(
    el("div", { class: "s-head" }, [el("div", {}, [el("p", { class: "kicker", text: "Moderation" }), el("h1", { text: "Reports" }), el("p", { class: "s-sub", text: "What people reported, and what's been done about it. Every action is recorded." })])]),
    body
  );
  section.append(root);
}

export function show() {
  load();
}
