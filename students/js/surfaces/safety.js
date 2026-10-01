// Safety & privacy: what is protected, exactly; who you've blocked; what
// you've reported; and how to leave. Written to be accurate rather than
// reassuring -- see LIMITATIONS.md for the long version.
import { el, openSheet, showToast } from "../ui.js";
import { supabaseClient } from "../../../src/client.js";
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
    lead: "Your profile, keys, study data, world and your copies of conversations are deleted. Messages you sent stay with the people you sent them to. Files in your archive should be deleted first if you want them gone. This can't be undone.",
    body: [el("label", { class: "field" }, [el("span", { text: `Type your username (${state.currentUsername}) to confirm` }), input])],
    actions: [
      { label: "Keep my account", kind: "btn-quiet" },
      {
        label: "Delete forever",
        kind: "btn-danger",
        onClick: async (b) => {
          if (input.value.trim().replace(/^@/, "") !== state.currentUsername) return showToast("That isn't your username."), false;
          b.disabled = true;
          const { error } = await supabaseClient.rpc("delete_my_account");
          if (error) {
            b.disabled = false;
            return showToast("Couldn't delete the account. Try again."), false;
          }
          showToast("Your account is deleted.", "success");
          ctx.signOut();
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

