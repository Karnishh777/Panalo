// Home: what you see on a computer before opening a chat.
//
// Built only from real state -- your unread chats, your pinned chats, and
// how this device is set up. No invented numbers, no feed. Message text is
// never shown here (just titles and counts), and hidden chats stay hidden
// unless they've been revealed this session.
//
// chat.js announces every change to the chat list with a "panalo:chats"
// event; this listens rather than reaching into chat.js.
import { state } from "./state.js";
import { el, setAvatar } from "./util.js";
import { formatCount } from "./unread.js";
import { icon } from "./icons.js";
import { displayTitle } from "./chatinfo.js";
import { isPinned } from "./prefs.js";
import { appLockEnabled, isChatHidden, hiddenVisible } from "./lock.js";
import { openSettings, getSetting } from "./settings.js";
import { notificationPermission } from "./notifications.js";

let chats = [];
let queued = false;

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function openChat(conv) {
  document.dispatchEvent(new CustomEvent("panalo:open-chat", { detail: { conversationId: conv.id } }));
}

function chatRow(conv, sub) {
  const avatar = el("div", { class: "avatar", "aria-hidden": "true" });
  const base = conv.type === "group" ? conv.name : conv.displayTitle || conv.name;
  setAvatar(avatar, base, conv.type === "group" ? null : conv.otherAvatar);
  return el("button", { class: "home-row", type: "button", onClick: () => openChat(conv) }, [
    avatar,
    el("span", { class: "home-row-main" }, [
      el("span", { class: "home-row-title", text: displayTitle(conv) }),
      el("span", { class: "home-row-sub", text: sub }),
    ]),
    conv.unread ? el("span", { class: "conv-badge", text: formatCount(conv.unread) }) : null,
  ]);
}

function card(title, sub, body) {
  return el("section", { class: "home-card" }, [
    el("div", { class: "home-card-head" }, [el("h3", { text: title }), sub ? el("span", { class: "home-card-sub", text: sub }) : null]),
    ...body,
  ]);
}

function empty(strong, text) {
  return el("div", { class: "home-empty" }, [el("strong", { text: strong }), el("span", { text: text })]);
}

function action(ico, tone, label, sub, onClick) {
  return el("button", { class: "home-action", type: "button", onClick }, [
    el("span", { class: `home-ico ${tone}`, "aria-hidden": "true" }, [icon(ico, 20)]),
    el("span", {}, [label, el("small", { text: sub })]),
  ]);
}

function statusRow(ok, text, linkText, onLink) {
  return el("li", {}, [
    el("span", { class: `status-dot ${ok ? "ok" : "warn"}`, "aria-hidden": "true" }),
    el("span", { text }),
    linkText ? el("button", { class: "text-link", type: "button", text: linkText, onClick: onLink }) : null,
  ]);
}

function render() {
  queued = false;
  const root = document.getElementById("no-chat-selected");
  if (!root || !state.currentUser) return;

  const visibleChats = chats.filter((c) => hiddenVisible() || !isChatHidden(c.id));
  const unread = visibleChats.filter((c) => c.unread > 0).sort((a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || "")));
  const pinned = visibleChats.filter((c) => isPinned(c.id));
  const totalUnread = unread.reduce((n, c) => n + c.unread, 0);

  const today = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const summary = !visibleChats.length
    ? "Welcome to Panalo."
    : totalUnread
      ? `${totalUnread} unread message${totalUnread === 1 ? "" : "s"} in ${unread.length} chat${unread.length === 1 ? "" : "s"}.`
      : "You're all caught up.";

  const newChat = () => document.getElementById("choose-direct")?.click();
  const newGroup = () => document.getElementById("choose-group")?.click();

  const desktopOn = getSetting("notifications") && notificationPermission() === "granted";

  const inner = el("div", { class: "home-inner" }, [
    el("h1", { class: "home-greeting", text: `${greeting()}, ${state.currentUsername || "there"}` }),
    el("p", { class: "home-date", text: `${today} · ${summary}` }),
    el("div", { class: "home-actions" }, [
      action("user", "tone-ember", "New chat", "Message one person", newChat),
      action("users", "tone-grape", "New group", "Friends, a class, a project", newGroup),
      action("palette", "tone-sun", "Make it yours", "Theme, colours, bubbles", () => openSettings("appearance")),
      action("shield", "tone-forest", "Privacy", "Locks, PINs, encryption", () => openSettings("privacy")),
    ]),
    el("div", { class: "home-grid" }, [
      card(
        "Unread",
        totalUnread ? formatCount(totalUnread) : null,
        unread.length
          ? unread.slice(0, 5).map((c) => chatRow(c, `${c.unread} new message${c.unread === 1 ? "" : "s"}`))
          : [
              visibleChats.length
                ? empty("You're all caught up ✨", "New messages will show up here.")
                : empty("No chats yet", "Start one with a friend's username — nobody can find you unless they know yours."),
            ]
      ),
      el("div", { class: "home-col" }, [
        card(
          "Pinned",
          null,
          pinned.length
            ? pinned.slice(0, 4).map((c) => chatRow(c, c.type === "group" ? "Group" : "Direct message"))
            : [empty("Nothing pinned", "Right-click or long-press a chat and choose Pin to keep it here.")]
        ),
        card("This device", null, [
          el("ul", { class: "status-list" }, [
            state.myPrivateKey
              ? statusRow(true, "Encryption is ready")
              : statusRow(false, "Messages are locked here", "Why?", () => openSettings("privacy")),
            appLockEnabled()
              ? statusRow(true, "App lock is on")
              : statusRow(false, "App lock is off", "Set up", () => openSettings("privacy")),
            desktopOn
              ? statusRow(true, "Desktop alerts are on")
              : statusRow(false, "Desktop alerts are off", "Turn on", () => openSettings("notifications")),
          ]),
        ]),
      ]),
    ]),
  ]);
  root.replaceChildren(inner);
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(render);
}

export function initHome() {
  document.addEventListener("panalo:chats", (e) => {
    chats = Array.isArray(e.detail) ? e.detail : [];
    schedule();
  });
  // Settings that change what the status card says.
  document.addEventListener("panalo:settings", schedule);
  document.getElementById("settings-modal")?.addEventListener("click", schedule);
}
