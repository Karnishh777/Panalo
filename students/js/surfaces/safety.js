// Safety & privacy: what is protected, exactly; who you've blocked; what
// you've reported; and how to leave. Written to be accurate rather than
// reassuring -- see LIMITATIONS.md for the long version.
import { el, openSheet, showToast } from "../ui.js";
import { supabaseClient } from "../../../src/client.js";
import { deleteAllMyFiles } from "../../../src/filestore.js";
import { idbDelKey } from "../../../src/encryption.js";
import { state } from "../../../src/state.js";
import { unblock } from "../signals-data.js";

let root;
let blockedEl;
let reportsEl;
let ctx;

const PROTECTED = [
  ["Messages and chat files", "Encrypted on your device before they're sent, with a key only the people in that conversation hold. The server stores ciphertext. Your private key is kept on the server encrypted with your password — that's what lets your history follow you to a new device, and it's also why this isn't “end-to-end encryption” in the strictest sense."],
  ["Who talks to whom", "Not hidden. The server can see which conversations you're in, when messages are sent, and how big they are — just not what they say."],
  ["Archive files", "Stored in a private space only you, or the conversation you shared them with, can open. Protected by access rules on the server, not end-to-end encrypted."],
  ["Your study life", "Tasks, focus sessions, calendar, goals, activity and your world are readable only by your account. They're stored on the server so they sync, and are not encrypted."],
  ["Your email", "Never shown to anyone. People find you only by your exact username, and nobody can browse the list of users."],
  ["What we don't do", "No ads, no selling data, no tracking scripts, and nothing you write is sent to an AI service."],
];

const TIPS = [
  "Never share your password or a login code — no real person from Panalo will ever ask for one.",
  "In rooms with people you've just met, keep your phone number, address and school timetable to yourself. That's what usernames are for.",
  "If someone pushes you to move to another app, send photos, or keep a secret, that's a reason to stop and talk to someone you trust.",
  "Block first, explain never. Blocking is silent: they aren't told.",
  "Report anything that worries you — especially if someone else might be at risk.",
  "If someone is in immediate danger, contact local emergency services or a trusted adult straight away. Reports aren't monitored around the clock.",
];

async function loadBlocked() {
  const { data, error } = await supabaseClient.from("blocks").select("blocked_id, created_at").order("created_at", { ascending: false });
  if (error) return blockedEl.replaceChildren(el("p", { class: "faint", text: "Blocking isn't available on this Panalo yet." }));
  if (!data.length) return blockedEl.replaceChildren(el("p", { class: "faint", text: "You haven't blocked anyone." }));
  const ids = data.map((b) => b.blocked_id);
  const { data: profs } = await supabaseClient.from("profiles").select("id, username").in("id", ids);
  const name = (id) => profs?.find((p) => p.id === id)?.username;
  blockedEl.replaceChildren(
    el(
      "ul",
      { class: "member-list" },
      data.map((b) =>
        el("li", {}, [
          el("b", { text: name(b.blocked_id) ? `@${name(b.blocked_id)}` : "Someone you no longer share a chat with" }),
          el("span", { class: "faint", text: `since ${new Date(b.created_at).toLocaleDateString()}` }),
          el("button", {
            type: "button",
            class: "btn btn-ghost btn-sm",
            text: "Unblock",
            onClick: async () => {
              const { error: e } = await unblock(b.blocked_id);
              showToast(e ? "Couldn't unblock." : "Unblocked. Their messages will show again.", e ? "error" : "success");
              loadBlocked();
            },
          }),
        ])
      )
    )
  );
}

async function loadReports() {
  const { data, error } = await supabaseClient.from("reports").select("id, reason, status, created_at").order("created_at", { ascending: false }).limit(50);
  if (error) return reportsEl.replaceChildren(el("p", { class: "faint", text: "Reporting isn't available on this Panalo yet." }));
  reportsEl.replaceChildren(
    data.length
      ? el("ul", { class: "log" }, data.map((r) => el("li", {}, [el("span", { class: "t", text: new Date(r.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }), el("span", {}, [r.reason.replace(/^\w/, (c) => c.toUpperCase()), " · ", el("span", { class: "tag tone-signal", text: r.status })])])))
      : el("p", { class: "faint", text: "No reports sent. You can report a person or a message from its ⋯ menu in Signals." })
  );
}

function deleteAccount() {
  const input = el("input", { type: "text", autocapitalize: "off", spellcheck: "false", placeholder: state.currentUsername });
  openSheet({
    title: "Delete your account?",
    lead: "Everything goes: your profile and keys, every message you sent (in every chat), every file you uploaded, your study data and world, and any conversation only you were in. Chats with other people carry on without you. Only your email and username are kept, locked away, for the 180 days the law requires. This can't be undone.",
    body: [el("label", { class: "field" }, [el("span", { text: `Type your username (${state.currentUsername}) to confirm` }), input])],
    actions: [
      { label: "Keep my account", kind: "btn-quiet" },
      {
        label: "Delete forever",
        kind: "btn-danger",
        onClick: async (b) => {
          if (input.value.trim().replace(/^@/, "") !== state.currentUsername) return showToast("That isn't your username."), false;
          b.disabled = true;
          b.textContent = "Deleting your files…";
          // Files first: SQL can't remove them, and once the account is gone
          // nobody can. Best effort per file -- a stuck file mustn't keep
          // someone in an account they asked to leave.
          await deleteAllMyFiles().catch(() => 0);
          b.textContent = "Deleting your account…";
          const { error } = await supabaseClient.rpc("delete_my_account");
          if (error) {
            b.disabled = false;
            b.textContent = "Delete forever";
            return showToast("Couldn't delete the account. Try again."), false;
          }
          const id = state.currentUser?.id;
          if (id) await idbDelKey(id).catch(() => {});
          try {
            for (const k of Object.keys(localStorage)) if (k.startsWith("panalo")) localStorage.removeItem(k);
          } catch {}
          showToast("Your account is deleted.", "success");
          ctx.signOut();
        },
      },
    ],
  });
}

// Everything the account holds that the database will hand back, as one
// JSON file (DPDP Act s.11, the right to a summary of your data). Messages
// come as stored: encrypted, with their dates and conversations.
async function downloadMyData(btn) {
  btn.disabled = true;
  btn.textContent = "Gathering…";
  try {
    const me = state.currentUser?.id;
    const get = async (table, q = (x) => x) => {
      const { data, error } = await q(supabaseClient.from(table).select("*"));
      return error ? { error: error.message } : data;
    };
    const out = {
      exported_at: new Date().toISOString(),
      note: "Your Panalo data. Messages are stored encrypted; their text is only readable in the app on your devices.",
      account: { id: me, email: state.currentUser?.email, username: state.currentUsername },
      profile: await get("profiles", (q) => q.eq("id", me)),
      age_and_consent: await get("account_age", (q) => q.eq("user_id", me)),
      student_profile: await get("student_profiles", (q) => q.eq("user_id", me)),
      tasks: await get("student_tasks", (q) => q.eq("user_id", me)),
      focus_sessions: await get("focus_sessions", (q) => q.eq("user_id", me)),
      calendar: await get("student_events", (q) => q.eq("user_id", me)),
      activity: await get("activity_log", (q) => q.eq("user_id", me)),
      goals: await get("student_goals", (q) => q.eq("user_id", me)),
      archive_files: await get("resources", (q) => q.eq("owner_id", me)),
      conversations: await get("conversation_participants", (q) => q.eq("user_id", me)),
      messages_sent: await get("messages", (q) => q.eq("user_id", me).order("created_at", { ascending: true }).limit(10000)),
      blocked: await get("blocks", (q) => q.eq("blocker_id", me)),
      reports_sent: await get("reports", (q) => q.eq("reporter_id", me)),
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `panalo-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    showToast("Your data is downloading.", "success");
  } catch (e) {
    showToast("Couldn't gather it. Try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Download my data";
  }
}

// A grievance or data request: a report about nobody, read by moderators.
function askAboutData() {
  const kind = el("select", {}, [
    ["question", "A question about my data"],
    ["correct", "Please correct something"],
    ["remove", "Please remove something"],
    ["complaint", "A complaint"],
  ].map(([v, t]) => el("option", { value: v, text: t })));
  const text = el("textarea", { rows: "5", maxlength: "900", required: "", placeholder: "What would you like us to know or do?" });
  openSheet({
    title: "Questions or complaints about your data",
    lead: "Only the people who run this Panalo read this. Don't include passwords.",
    body: [el("label", { class: "field" }, [el("span", { text: "About" }), kind]), el("label", { class: "field" }, [el("span", { text: "Message" }), text])],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Send",
        kind: "btn-primary",
        submit: true,
        onClick: async () => {
          if (!text.value.trim()) return showToast("Write a message first."), false;
          const { error } = await supabaseClient.from("reports").insert([{ reason: "other", details: `[Data request: ${kind.value}] ${text.value.trim()}` }]);
          if (error) return showToast(error.code === "54000" ? error.message : "Couldn't send it. Try again."), false;
          showToast("Sent. You'll hear back within 15 days.", "success");
          loadReports();
        },
      },
    ],
  });
}

export function mount(section, c) {
  ctx = c;
  root = el("div", { class: "safety-page" });
  blockedEl = el("div");
  reportsEl = el("div");
  root.append(
    el("div", { class: "s-head" }, [el("div", {}, [el("p", { class: "kicker toned tone-signal", text: "Safety & privacy" }), el("h1", { text: "What's protected, exactly" }), el("p", { class: "s-sub", text: "Plain language, no fine print. If something here surprises you, it's better you know." })])]),
    el("div", { class: "safety-cols" }, [
      el("section", { class: "panel tone-signal" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Where your things live" }), el("a", { href: "privacy.html", target: "_blank", rel: "noopener", text: "Full privacy notes" })]), el("dl", { class: "protect" }, PROTECTED.flatMap(([t, d]) => [el("dt", { text: t }), el("dd", { text: d })]))]),
      el("div", {}, [
        el("section", { class: "panel tone-alert" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Blocked" })]), blockedEl]),
        el("section", { class: "panel tone-time" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Reports you've sent" })]), reportsEl]),
        el("section", { class: "panel tone-world" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Staying safe here" }), el("a", { href: "rules.html", target: "_blank", rel: "noopener", text: "Community rules" })]), el("ul", { class: "tips" }, TIPS.map((t) => el("li", { text: t })))]),
        el("section", { class: "panel tone-world" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Your data" })]), el("p", { class: "muted", text: "Download everything your account holds, as a file you can keep." }), el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Download my data", onClick: (e) => downloadMyData(e.currentTarget) })]),
        el("section", { class: "panel tone-focus" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Questions or complaints about your data" })]), el("p", { class: "muted", text: "Ask what's kept about you, ask for something to be corrected or removed, or complain about how your data or a report was handled. It goes to the people who run this Panalo; expect an answer within 15 days." }), el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Write to us", onClick: askAboutData }), el("p", { class: "faint", text: "Or email the Grievance Officer, K.V.Karnishh: karnishh.education@gmail.com" })]),
        el("section", { class: "panel tone-alert" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Leaving" })]), el("p", { class: "muted", text: "You can delete your account at any time." }), el("button", { type: "button", class: "btn btn-danger btn-sm", text: "Delete my account", onClick: deleteAccount })]),
      ]),
    ])
  );
  section.append(root);
}

export function show() {
  blockedEl.replaceChildren(el("div", { class: "loading-line" }));
  reportsEl.replaceChildren(el("div", { class: "loading-line" }));
  loadBlocked();
  loadReports();
}

