// Privacy & data: what is kept and who can see it (nobody but you), help
// if you need it, your data to download or ask about, and how to leave.
// Written to be accurate rather than reassuring -- see LIMITATIONS.md.
import { el, openSheet, showToast, getPrefs, setPrefs } from "../ui.js";
import { sealedJourney } from "../journey.js";
import { supabaseClient } from "../../../src/client.js";
import { deleteAllMyFiles } from "../../../src/filestore.js";
import { idbDelKey } from "../../../src/encryption.js";
import { state } from "../../../src/state.js";

let root;
let requestsEl;
let ctx;

const PROTECTED = [
  ["Who can see you", "Nobody. Panalo Students has no profiles, no feed, no chat and no “online” status: nothing you do here is shown to anyone else."],
  ["Your study life", "Tasks, focus sessions, calendar, goals, journal, activity and your world are readable only by your account. They're stored on the server so they sync, and are not encrypted."],
  ["Archive files", "Stored in a private space only you can open. Protected by access rules on the server, not end-to-end encrypted."],
  ["Your email", "Never shown to anyone. You can log in with it or with your username."],
  ["What we don't do", "No ads, no selling data, no tracking scripts, and nothing you write is sent to an AI service."],
];

// People to call, in India, at any hour. Tap to dial on a phone.
const HELP = [
  ["112", "Emergency", "Police, fire or ambulance — if you or someone else is in danger right now."],
  ["1098", "CHILDLINE", "For anyone under 18 who needs help or protection. Free, day and night."],
  ["14416", "Tele-MANAS", "Someone to talk to about stress, low mood or anything heavy. Free, 24×7, in many languages."],
  ["1930", "Cyber crime", "Online fraud, threats or someone misusing your photos. Or report at cybercrime.gov.in."],
];

// A short check-up you tick for yourself (kept in your preferences).
const CHECKS = [
  ["password", "My password isn't used on any other site."],
  ["code", "I never share a login code, with anyone."],
  ["trusted", "There's a trusted adult I'd tell if something felt wrong."],
];

function helpPanel() {
  return el("section", { class: "panel tone-alert help-now", "aria-labelledby": "help-now-h" }, [
    el("div", { class: "panel-head" }, [el("h2", { id: "help-now-h", text: "Need help now?" })]),
    el("ul", { class: "help-list" }, HELP.map(([num, name, what]) => el("li", {}, [el("a", { class: "help-call", href: `tel:${num}`, "aria-label": `Call ${name}, ${num}` }, [el("b", { class: "num", text: num }), el("span", { text: name })]), el("p", { class: "muted", text: what })]))),
    el("p", { class: "faint", text: "Outside India? Call your local emergency number. Panalo is not an emergency service." }),
  ]);
}

function checkPanel() {
  const box = el("div");
  const draw = () => {
    const done = getPrefs().safetyCheck || {};
    const n = CHECKS.filter(([id]) => done[id]).length;
    box.replaceChildren(
      el("p", { class: "check-score" }, [el("b", { class: "num", text: `${n} of ${CHECKS.length}` }), el("span", { class: "muted", text: n === CHECKS.length ? " — all set. Well done looking after yourself." : " — tick what's true for you." })]),
      el("span", { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(CHECKS.length), "aria-valuenow": String(n), "aria-label": "Safety check-up" }, [el("i", { style: `width:${(n / CHECKS.length) * 100}%` })]),
      el("ul", { class: "check-list" }, CHECKS.map(([id, text]) => {
        const c = el("input", { type: "checkbox" });
        c.checked = !!done[id];
        c.addEventListener("change", () => {
          setPrefs({ safetyCheck: { ...(getPrefs().safetyCheck || {}), [id]: c.checked } });
          draw();
        });
        return el("li", {}, [el("label", { class: "check-item" }, [c, el("span", { text })])]);
      }))
    );
  };
  draw();
  return el("section", { class: "panel tone-world", "aria-labelledby": "check-h" }, [el("div", { class: "panel-head" }, [el("h2", { id: "check-h", text: "Safety check-up" })]), box]);
}

const TIPS = [
  "Never share your password or a login code — no real person from Panalo will ever ask for one.",
  "Panalo will never message you inside the app or ask you to install anything. Anyone who claims to be from Panalo and asks for your details isn't.",
  "If studying is getting heavy, it's fine to stop for the day. Talk to someone you trust, or call one of the numbers above.",
  "If someone is in immediate danger, contact local emergency services or a trusted adult straight away.",
];

// Requests you've sent about your data, and where each one is.
async function loadRequests() {
  const { data, error } = await supabaseClient.from("reports").select("id, details, status, created_at").order("created_at", { ascending: false }).limit(50);
  if (error) return requestsEl.replaceChildren(el("p", { class: "faint", text: "Requests aren't available on this Panalo yet." }));
  const label = (d) => (d || "").match(/^\[Data request: (\w+)\]/)?.[1] || "request";
  requestsEl.replaceChildren(
    data.length
      ? el("ul", { class: "log" }, data.map((r) => el("li", {}, [el("span", { class: "t", text: new Date(r.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }), el("span", {}, [label(r.details).replace(/^\w/, (c) => c.toUpperCase()), " · ", el("span", { class: "tag tone-signal", text: r.status })])])))
      : el("p", { class: "faint", text: "None sent." })
  );
}

function deleteAccount() {
  const input = el("input", { type: "text", autocapitalize: "off", spellcheck: "false", placeholder: state.currentUsername });
  openSheet({
    title: "Delete your account?",
    lead: "Everything goes: your study data and world, every file you uploaded, your profile and keys — and, if you also use Panalo Chat with this account, every message you sent there. Only your email and username are kept, locked away, for the 180 days the law requires. This can't be undone.",
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
      journal: await get("daily_entries", (q) => q.eq("user_id", me).order("day", { ascending: true })),
      plan_progress: await get("student_topics", (q) => q.eq("user_id", me)),
      results: await get("student_results", (q) => q.eq("user_id", me).order("taken_on", { ascending: true })),
      archive_files: await get("resources", (q) => q.eq("owner_id", me)),
      conversations: await get("conversation_participants", (q) => q.eq("user_id", me)),
      messages_sent: await get("messages", (q) => q.eq("user_id", me).order("created_at", { ascending: true }).limit(10000)),
      blocked: await get("blocks", (q) => q.eq("blocker_id", me)),
      reports_sent: await get("reports", (q) => q.eq("reporter_id", me)),
    };
    // The study journey, sealed to this account: this file can bring it
    // back (Settings → Your journey).
    try {
      const { journey, seal } = await sealedJourney();
      Object.assign(out, { journey, seal });
    } catch {
      /* before phase 36: the rest is still the full download */
    }
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
          loadRequests();
        },
      },
    ],
  });
}

export function mount(section, c) {
  ctx = c;
  root = el("div", { class: "safety-page" });
  requestsEl = el("div");
  root.append(
    el("div", { class: "s-head" }, [el("div", {}, [el("p", { class: "kicker toned tone-signal", text: "Privacy & data" }), el("h1", { text: "Yours, and only yours" }), el("p", { class: "s-sub", text: "Plain language, no fine print. If something here surprises you, it's better you know." })])]),
    el("div", { class: "safety-cols" }, [
      el("section", { class: "panel tone-signal" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Where your things live" }), el("a", { href: "privacy.html", target: "_blank", rel: "noopener", text: "Full privacy notes" })]), el("dl", { class: "protect" }, PROTECTED.flatMap(([t, d]) => [el("dt", { text: t }), el("dd", { text: d })]))]),
      el("div", {}, [
        helpPanel(),
        el("section", { class: "panel tone-world" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Staying safe" }), el("a", { href: "rules.html", target: "_blank", rel: "noopener", text: "Rules" })]), el("ul", { class: "tips" }, TIPS.map((t) => el("li", { text: t })))]),
        checkPanel(),
        el("section", { class: "panel tone-world" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Your data" })]), el("p", { class: "muted", text: "Download everything your account holds, as a file you can keep." }), el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Download my data", onClick: (e) => downloadMyData(e.currentTarget) })]),
        el("section", { class: "panel tone-focus" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Questions or complaints about your data" })]), el("p", { class: "muted", text: "Ask what's kept about you, ask for something to be corrected or removed, or complain about how your data was handled. It goes to the people who run this Panalo; expect an answer within 15 days." }), el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Write to us", onClick: askAboutData }), requestsEl, el("p", { class: "faint", text: "Or email the Grievance Officer, K.V.Karnishh: karnishh.education@gmail.com" })]),
        el("section", { class: "panel tone-alert" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Leaving" })]), el("p", { class: "muted", text: "You can delete your account at any time." }), el("button", { type: "button", class: "btn btn-danger btn-sm", text: "Delete my account", onClick: deleteAccount })]),
      ]),
    ])
  );
  section.append(root);
}

export function show() {
  requestsEl.replaceChildren(el("div", { class: "loading-line" }));
  loadRequests();
}

