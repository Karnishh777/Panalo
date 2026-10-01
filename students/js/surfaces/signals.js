// Signals: every conversation, sorted by what it is for.
//
// The list is not one long inbox. People, crews, study circles, classes,
// projects and rooms are separate constellations, because "my physics
// circle" and "my friends" and "the hackathon room that ends on Sunday" are
// different kinds of thing and you look for them differently. Unread is a
// pulse on the star; a room shows how long it has left.
import { el, openSheet, confirmSheet, popMenu, showToast, emptyState, chipGroup } from "../ui.js";
import { store, on } from "../store.js";
import { state } from "../../../src/state.js";
import { messagePlaintext, getConversationKey, keyProblemFor } from "../../../src/encryption.js";
import { lockedPreview, isKeyRequest } from "../../../src/keystatus.js";
import { renderKeyRequest, renderKeyBanner } from "../../../src/keyshare.js";
import { renderAttachment } from "../../../src/mediabubble.js";
import { loadEncrypted } from "../../../src/attachments.js";
import { splitLinks } from "../../../src/util.js";
import { isOnline, setPresenceListener } from "../../../src/presence.js";
import { relTime, clockTime, dayKey } from "../model/time.js";
import { saveToArchive } from "../archive-data.js";
import * as S from "../signals-data.js";

let root;
let listEl;
let paneEl;
let filter = { text: "", context: "all" };
let current = null; // open conversation
let thread = null; // { list, oldest, more, ids:Set }
let unsubs = [];
let navigate;

export { startInbox } from "../signals-data.js";

const PENDING_KEY = "panalo.students.doors"; // convId -> room name, for rooms I'm waiting at
function doors() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function setDoor(id, name) {
  const d = doors();
  if (name) d[id] = name;
  else delete d[id];
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(d));
  } catch {}
}

// ---- the list --------------------------------------------------------------------------

function star(conv) {
  // Brighter and larger the more recently something happened.
  const age = (Date.now() - Date.parse(conv.lastAt || conv.created_at || 0)) / 3600000;
  const b = age < 1 ? 1 : age < 24 ? 0.8 : age < 168 ? 0.55 : 0.35;
  const s = el("span", { class: `sig-star${conv.unread ? " pulsing" : ""}`, "aria-hidden": "true" });
  s.style.setProperty("--b", b);
  if (conv.type === "direct" && conv.otherUserId && isOnline(conv.otherUserId)) s.classList.add("online");
  return s;
}

function timeLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (dayKey(d) === dayKey(new Date())) return clockTime(d);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function row(conv) {
  const waiting = store.requests.filter((r) => r.conversation_id === conv.id).length;
  const meta = [];
  if (conv.ends_at) meta.push(el("span", { class: "tag tone-time", text: `ends ${relTime(Date.parse(conv.ends_at))}` }));
  if (waiting) meta.push(el("span", { class: "tag tone-signal", text: `${waiting} at the door` }));
  if (conv.posting === "hosts") meta.push(el("span", { class: "tag", text: "hosts post" }));
  return el(
    "a",
    {
      href: `#/signals/${conv.id}`,
      class: `sig-row${current?.id === conv.id ? " active" : ""}${conv.unread ? " unread" : ""}`,
      "aria-current": current?.id === conv.id ? "true" : null,
    },
    [
      star(conv),
      el("span", { class: "sig-main" }, [
        el("span", { class: "sig-title" }, [el("b", { text: S.titleOf(conv) }), ...meta]),
        el("span", { class: "sig-preview", text: conv.preview || (conv.type === "direct" ? "Say hello." : "Nothing yet.") }),
      ]),
      el("span", { class: "sig-side" }, [
        el("span", { class: "sig-time num", text: timeLabel(conv.lastAt) }),
        conv.unread ? el("span", { class: "pulse-count", text: conv.unread > 99 ? "99+" : String(conv.unread), "aria-label": `${conv.unread} unread` }) : null,
      ]),
    ]
  );
}

function renderList() {
  if (!listEl) return;
  const q = filter.text.trim().toLowerCase();
  const convs = store.conversations.filter((c) => !q || S.titleOf(c).toLowerCase().includes(q));
  const groups = S.CONTEXTS.map((ctx) => ({ ctx, items: convs.filter((c) => S.contextOf(c) === ctx.id) })).filter((g) => g.items.length);

  const chips = el("div", { class: "chips sig-chips", role: "tablist", "aria-label": "Filter by kind" }, [
    el("button", { type: "button", role: "tab", class: "chip", "aria-selected": String(filter.context === "all"), text: "All", onClick: () => setContext("all") }),
    ...groups.map((g) => {
      const unread = g.items.reduce((n, c) => n + (c.unread || 0), 0);
      return el("button", { type: "button", role: "tab", class: `chip ${g.ctx.tone}`, "aria-selected": String(filter.context === g.ctx.id), onClick: () => setContext(g.ctx.id) }, [
        el("span", { class: "dot" }),
        g.ctx.label,
        unread ? el("span", { class: "chip-count num", text: String(unread) }) : null,
      ]);
    }),
  ]);

  const waitingDoors = Object.entries(doors()).filter(([id]) => !store.conversations.some((c) => c.id === id));
  const doorSection = waitingDoors.length
    ? el("section", { class: "sig-group tone-time" }, [
        el("h2", { class: "sig-group-h" }, [el("span", { text: "At the door" }), el("small", { text: "waiting for a host to let you in" })]),
        ...waitingDoors.map(([id, name]) =>
          el("div", { class: "sig-row door" }, [
            el("span", { class: "sig-star pulsing", "aria-hidden": "true" }),
            el("span", { class: "sig-main" }, [el("b", { text: name }), el("span", { class: "sig-preview", text: "You asked to join. You'll be let in by a host." })]),
            el("button", {
              type: "button",
              class: "btn btn-quiet btn-sm",
              text: "Cancel",
              onClick: async () => {
                await S.cancelRequest(id);
                setDoor(id, null);
                renderList();
              },
            }),
          ])
        ),
      ])
    : null;

  const shown = filter.context === "all" ? groups : groups.filter((g) => g.ctx.id === filter.context);
  const body = shown.length
    ? shown.map((g) =>
        el("section", { class: `sig-group ${g.ctx.tone}`, "aria-label": g.ctx.label }, [
          el("h2", { class: "sig-group-h" }, [el("span", { text: g.ctx.label }), el("small", { text: g.ctx.sub })]),
          ...g.items.map(row),
        ])
      )
    : [
        emptyState(
          q ? "Nothing by that name." : "No signals yet.",
          q ? "Names have to match what the conversation is called." : "Message someone by their exact username, form a circle, or open a room for an event.",
          q ? null : el("button", { type: "button", class: "btn btn-primary", text: "Start something", onClick: () => openNew() })
        ),
      ];

  listEl.querySelector(".sig-chips-slot").replaceChildren(groups.length > 1 ? chips : el("span"));
  listEl.querySelector(".sig-body").replaceChildren(...[doorSection, ...body].filter(Boolean));
}

function setContext(id) {
  filter.context = id;
  renderList();
}

// ---- the thread ----------------------------------------------------------------------

function renderText(node, text) {
  node.replaceChildren(
    ...splitLinks(text).map((part) =>
      part.type === "link" ? el("a", { href: part.href, target: "_blank", rel: "noopener noreferrer nofollow", text: part.value }) : document.createTextNode(part.value)
    )
  );
}

function daySep(iso) {
  const d = new Date(iso);
  const today = dayKey(new Date());
  const label = dayKey(d) === today ? "Today" : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return el("div", { class: "msg-day", "data-day": dayKey(d), role: "separator", text: label });
}

function messageNode(msg, { pending = false } = {}) {
  const mine = msg.user_id === state.currentUser.id;
  const group = current?.type === "group";
  const node = el("div", { class: `msg ${mine ? "mine" : "theirs"}${pending ? " pending" : ""}`, id: `m-${msg.id}`, "data-cid": msg.client_id || "" });
  if (isKeyRequest(msg.content) && !msg.iv) {
    node.classList.add("system");
    node.append(renderKeyRequest({ msg, isMine: mine, isMember: true }));
    return node;
  }
  if (!mine && group) node.append(el("span", { class: "msg-who", text: msg.username || "someone" }));
  const bubble = el("div", { class: "msg-bubble" });
  if (msg.file_url || msg._localFile) {
    const att = msg._localFile
      ? el("div", { class: "msg-file-local", text: `📎 ${msg._localFile.name}` })
      : renderAttachment(msg, { getKey: getConversationKey, lockedLabel: (id) => lockedPreview(keyProblemFor(id)) });
    if (att) bubble.append(att);
  }
  const text = el("p", { class: "msg-text" });
  if (msg._plain != null) renderText(text, msg._plain);
  else if (msg.content) {
    messagePlaintext(msg).then((t) => {
      msg._plain = t;
      renderText(text, t);
    });
  }
  if (msg.content || msg._plain) bubble.append(text);
  node.append(bubble);
  const meta = el("div", { class: "msg-meta" }, [el("time", { datetime: msg.created_at, text: clockTime(msg.created_at) })]);
  if (pending) meta.append(el("span", { class: "msg-state", text: "sending…" }));
  node.append(meta);
  if (!pending) {
    const more = el("button", { type: "button", class: "msg-more", "aria-label": "Message actions", text: "⋯" });
    more.addEventListener("click", () => messageActions(msg, more, text));
    node.append(more);
  }
  return node;
}

function appendMessage(msg, { prepend = false } = {}) {
  if (!thread || thread.ids.has(msg.id)) return;
  thread.ids.add(msg.id);
  const list = thread.list;
  const day = dayKey(msg.created_at);
  if (prepend) {
    const first = list.querySelector(".msg-day");
    if (first && first.dataset.day === day) first.remove();
    list.prepend(daySep(msg.created_at), messageNode(msg));
    // keep one separator per day: re-add the old first separator handled above
    return;
  }
  const lastDay = [...list.querySelectorAll(".msg-day")].pop();
  if (!lastDay || lastDay.dataset.day !== day) list.append(daySep(msg.created_at));
  // A message we sent ourselves replaces its optimistic copy.
  const temp = msg.client_id && list.querySelector(`.msg.pending[data-cid="${msg.client_id}"]`);
  if (temp) temp.replaceWith(messageNode(msg));
  else list.append(messageNode(msg));
}

function nearBottom() {
  const sc = thread?.scroller;
  return !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
}
function toBottom() {
  if (thread?.scroller) thread.scroller.scrollTop = thread.scroller.scrollHeight;
}

async function messageActions(msg, anchor, textNode) {
  const mine = msg.user_id === state.currentUser.id;
  const items = [];
  const text = msg._plain || textNode.textContent;
  if (text) items.push({ label: "Copy text", onClick: () => navigator.clipboard?.writeText(text).then(() => showToast("Copied.", "success")) });
  if (msg.file_url) {
    items.push({
      label: "Save file to my Archive",
      onClick: async () => {
        const entry = await loadEncrypted(msg.file_url, await getConversationKey(msg.conversation_id));
        if (!entry) return showToast("That file can't be opened on this device.");
        const blob = await fetch(entry.objectUrl).then((r) => r.blob());
        const file = new File([blob], entry.name, { type: entry.type });
        const r = await saveToArchive(file, { title: entry.name, shelf: S.titleOf(current) });
        showToast(r.error ? r.error.message : "Saved to your Archive (private).", r.error ? "error" : "success");
      },
    });
  }
  if (mine) {
    items.push({
      label: "Delete for everyone",
      danger: true,
      onClick: async () => {
        if (!(await confirmSheet({ title: "Delete this message?", lead: "It disappears for everyone in the conversation. Someone may already have read or copied it.", confirm: "Delete", danger: true }))) return;
        const { error } = await S.deleteMessage(msg.id);
        if (error) return showToast("Couldn't delete it.");
        document.getElementById(`m-${msg.id}`)?.remove();
      },
    });
  } else {
    items.push({ label: `Report this message`, onClick: () => openReport({ userId: msg.user_id, username: msg.username, conversationId: msg.conversation_id, messageId: msg.id, evidence: text }) });
    items.push({ label: `Block @${msg.username || "them"}`, danger: true, onClick: () => confirmBlock(msg.user_id, msg.username) });
  }
  popMenu(anchor, items);
}

async function openThread(id) {
  const conv = store.conversations.find((c) => c.id === id);
  if (!conv) {
    if (!store.conversations.length) await S.refreshConversations();
    const again = store.conversations.find((c) => c.id === id);
    if (!again) {
      paneEl.replaceChildren(emptyState("Not here.", "This conversation doesn't exist, has ended, or you're no longer in it.", el("a", { class: "btn btn-ghost", href: "#/signals", text: "Back to Signals" })));
      return;
    }
    return openThread(id);
  }
  current = conv;
  S.setOpenConversation(conv.id);
  root.classList.add("thread-open");
  renderList();

  const ctx = S.CONTEXTS.find((c) => c.id === S.contextOf(conv));
  const sub = [];
  if (conv.type === "direct") sub.push(conv.otherUserId && isOnline(conv.otherUserId) ? "online now" : "one to one");
  else sub.push(`${conv.members.length} ${conv.members.length === 1 ? "member" : "members"}`);
  if (conv.ends_at) sub.push(`ends ${relTime(Date.parse(conv.ends_at))}`);
  if (conv.posting === "hosts") sub.push("only hosts post");

  const scroller = el("div", { class: "thread-scroll", role: "log", "aria-live": "polite", "aria-label": `Messages in ${S.titleOf(conv)}`, tabindex: "0" });
  const list = el("div", { class: "thread-list" });
  const older = el("button", { type: "button", class: "btn btn-quiet btn-sm thread-older", text: "Load earlier messages", hidden: "" });
  const banner = el("div", { class: "thread-banner" });
  scroller.append(older, list);
  thread = { list, scroller, oldest: null, more: false, ids: new Set() };

  const canPost = conv.posting !== "hosts" || conv.isHost;
  const composer = canPost ? composerFor(conv) : el("p", { class: "composer-note", text: "Only hosts post in this room. You'll see everything they share here." });

  paneEl.replaceChildren(
    el("header", { class: `thread-head ${ctx?.tone || ""}` }, [
      el("a", { href: "#/signals", class: "icon-btn thread-back", "aria-label": "Back to all signals", text: "←" }),
      el("div", { class: "thread-title" }, [el("h2", { text: S.titleOf(conv) }), el("p", {}, [el("span", { class: "tag", text: ctx?.label || "" }), ` ${sub.join(" · ")}`])]),
      el("button", { type: "button", class: "btn btn-ghost btn-sm", text: conv.type === "group" ? "Members & door" : "Details", onClick: () => openInfo(conv) }),
    ]),
    banner,
    scroller,
    composer
  );

  const { messages, more, error } = await S.fetchMessages(conv.id);
  if (current !== conv) return;
  if (error) {
    list.append(el("p", { class: "error-line", text: "Couldn't load messages. Check your connection." }));
    return;
  }
  await Promise.all(messages.map(async (m) => (m._plain = m.content ? await messagePlaintext(m) : "")));
  if (!messages.length) list.append(el("p", { class: "thread-empty faint", text: conv.ends_at ? "The room is open. Say hello — and remember it ends on schedule." : "Nothing here yet. The first message is always the hardest." }));
  messages.forEach((m) => appendMessage(m));
  thread.oldest = messages[0]?.created_at || null;
  thread.more = more;
  older.hidden = !more;
  older.onclick = async () => {
    const r = await S.fetchMessages(conv.id, thread.oldest);
    if (r.error || current !== conv) return;
    const h = scroller.scrollHeight;
    await Promise.all(r.messages.map(async (m) => (m._plain = m.content ? await messagePlaintext(m) : "")));
    r.messages.slice().reverse().forEach((m) => appendMessage(m, { prepend: true }));
    thread.oldest = r.messages[0]?.created_at || thread.oldest;
    older.hidden = !r.more;
    scroller.scrollTop = scroller.scrollHeight - h;
  };
  toBottom();
  S.markOpenRead();
  renderKeyBanner(conv.id, { onRetry: () => openThread(conv.id) })
    .then((b) => b && current === conv && banner.replaceChildren(b))
    .catch(() => {});
}

function composerFor(conv) {
  const form = el("form", { class: "composer", novalidate: "" });
  const input = el("textarea", { rows: "1", placeholder: `Message ${S.titleOf(conv)}`, "aria-label": "Message", maxlength: "4000", enterkeyhint: "send" });
  const file = el("input", { type: "file", class: "sr-only", tabindex: "-1", "aria-hidden": "true" });
  const attach = el("button", { type: "button", class: "icon-btn", "aria-label": "Attach a file", text: "＋", onClick: () => file.click() });
  const send = el("button", { type: "submit", class: "btn btn-primary btn-sm", text: "Send" });
  const autosize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(160, input.scrollHeight)}px`;
  };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  file.addEventListener("change", () => {
    const f = file.files[0];
    file.value = "";
    if (f) doSend(conv, { text: "", file: f });
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    autosize();
    doSend(conv, { text });
  });
  form.append(attach, file, input, send);
  return form;
}

async function doSend(conv, { text, file = null, clientId = crypto.randomUUID() }) {
  if (!thread) return;
  thread.list.querySelector(".thread-empty")?.remove();
  const temp = { id: `temp-${clientId}`, client_id: clientId, user_id: state.currentUser.id, username: state.currentUsername, created_at: new Date().toISOString(), conversation_id: conv.id, _plain: text, _localFile: file };
  const node = messageNode(temp, { pending: true });
  thread.list.append(node);
  toBottom();
  const r = await S.sendMessage(conv, { text, file, clientId });
  if (r.error) {
    node.classList.add("failed");
    const meta = node.querySelector(".msg-meta");
    meta.replaceChildren(
      el("span", { class: "msg-state", text: r.error.message }),
      el("button", {
        type: "button",
        class: "link-btn",
        text: "Retry",
        onClick: () => {
          node.remove();
          doSend(conv, { text, file, clientId });
        },
      })
    );
    return;
  }
  r.message._plain = text;
  if (!thread.ids.has(r.message.id)) {
    thread.ids.add(r.message.id);
    node.replaceWith(messageNode(r.message));
  } else node.remove();
}

// ---- details, members, the door ---------------------------------------------------------

async function openInfo(conv) {
  const me = state.currentUser.id;
  const body = [];
  const cleanups = [];
  const key = await getConversationKey(conv.id);
  body.push(
    el("p", { class: "info-enc faint" }, [
      key
        ? "Messages and files here are encrypted on members' devices before they're sent. "
        : "This conversation has no encryption key on this device — someone in it may never have set up encryption, or you were added without a key. ",
      el("a", { href: "privacy.html#encryption", target: "_blank", rel: "noopener", text: "What that covers" }),
    ])
  );

  if (conv.type === "group" && conv.isHost) {
    const hostBits = [];
    if (conv.kind !== "event") {
      const kinds = S.CONTEXTS.filter((c) => !["people", "event", "other"].includes(c.id));
      hostBits.push(
        el("div", { class: "info-block" }, [
          el("h3", { text: "What is this circle for?" }),
          chipGroup({ label: "Kind", value: conv.kind, options: kinds.map((k) => ({ id: k.id, label: k.label })), onChange: async (k) => !(await S.setKind(conv, k)).error && showToast("Updated.", "success") }).node,
        ])
      );
    }
    hostBits.push(
      el("div", { class: "info-block" }, [
        el("h3", { text: "Who can post" }),
        chipGroup({
          label: "Who can post",
          value: conv.posting || "everyone",
          options: [
            { id: "everyone", label: "Everyone" },
            { id: "hosts", label: "Only hosts (announcements)" },
          ],
          onChange: async (p) => {
            const { error } = await S.setPosting(conv, p);
            showToast(error ? "Couldn't change that." : p === "hosts" ? "Only hosts can post now." : "Everyone can post.", error ? "error" : "success");
          },
        }).node,
      ])
    );
    hostBits.push(await doorBlock(conv, cleanups));
    body.push(el("section", { class: "info-hosts" }, hostBits));
  }

  const others = conv.members.filter((m) => m.id !== me);
  body.push(
    el("div", { class: "info-block" }, [
      el("h3", { text: conv.type === "group" ? `Members · ${conv.members.length}` : "With" }),
      el(
        "ul",
        { class: "member-list" },
        conv.members.map((m) =>
          el("li", {}, [
            el("span", { class: `sig-star${isOnline(m.id) ? " online" : ""}`, "aria-hidden": "true" }),
            el("b", { text: `@${m.username}${m.id === me ? " (you)" : ""}` }),
            m.role !== "member" && conv.type === "group" ? el("span", { class: "tag tone-time", text: m.role === "owner" ? "host" : "co-host" }) : null,
            m.id !== me
              ? el("button", {
                  type: "button",
                  class: "icon-btn sm",
                  "aria-label": `Options for @${m.username}`,
                  text: "⋯",
                  onClick: (e) =>
                    popMenu(e.currentTarget, [
                      conv.type === "group"
                        ? {
                            label: "Message privately",
                            onClick: async () => {
                              sheet.close();
                              const r = await S.startDirect(m.username);
                              if (r.error) showToast(r.error.message);
                              else navigate(`signals/${r.conversation.id}`);
                            },
                          }
                        : null,
                      { label: "Report", onClick: () => openReport({ userId: m.id, username: m.username, conversationId: conv.id }) },
                      { label: "Block", danger: true, onClick: () => confirmBlock(m.id, m.username) },
                    ]),
                })
              : null,
          ])
        )
      ),
      conv.kind === "event" && others.length ? el("p", { class: "field-hint", text: "Met someone worth keeping in touch with? Message them privately before the room ends — no phone numbers needed." }) : null,
    ])
  );

  const leaveLabel = conv.type === "group" ? "Leave" : "Delete my copy";
  const actions = [];
  if (conv.kind === "event" && conv.isHost) {
    actions.push(
      el("button", {
        type: "button",
        class: "btn btn-danger btn-sm",
        text: "End the room now",
        onClick: async () => {
          if (!(await confirmSheet({ title: "End this room?", lead: "In about a minute it disappears for everyone, and a day later it's deleted with everything in it.", confirm: "End room", danger: true }))) return;
          const { error } = await S.endRoomSoon(conv);
          showToast(error ? "Couldn't end it." : "The room ends in a minute.", error ? "error" : "success");
        },
      })
    );
  }
  actions.push(
    el("button", {
      type: "button",
      class: "btn btn-ghost btn-sm",
      text: leaveLabel,
      onClick: async () => {
        const ok = await confirmSheet({
          title: conv.type === "group" ? `Leave ${S.titleOf(conv)}?` : "Delete your copy?",
          lead: "Your copy goes; everyone else keeps theirs. To come back, someone will have to add you again.",
          confirm: leaveLabel,
          danger: true,
        });
        if (!ok) return;
        const { error } = await S.leave(conv);
        if (error) return showToast("Couldn't do that. Try again.");
        sheet.close();
        navigate("signals");
      },
    })
  );
  body.push(el("div", { class: "info-actions" }, actions));

  const sheet = openSheet({ title: S.titleOf(conv), lead: S.CONTEXTS.find((c) => c.id === S.contextOf(conv))?.sub, body, wide: true, form: false, onClose: () => cleanups.forEach((f) => f()) });
}

async function doorBlock(conv, cleanups) {
  const block = el("div", { class: "info-block door-block" });
  const draw = async () => {
    const code = await S.getCode(conv.id);
    const waiting = store.requests.filter((r) => r.conversation_id === conv.id);
    const parts = [el("h3", { text: "The door" })];
    if (code) {
      const link = S.inviteLink(code);
      const qr = el("div", { class: "qr", "aria-hidden": "true" });
      parts.push(
        el("p", { class: "field-hint", text: "Anyone with this code or link can ask to join. Nobody gets in until a host lets them in." }),
        el("div", { class: "door-code" }, [
          el("span", { class: "code num", text: S.prettyCode(code), "aria-label": `Join code ${code.split("").join(" ")}` }),
          qr,
        ]),
        el("div", { class: "chips" }, [
          el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Copy invite link", onClick: () => navigator.clipboard?.writeText(link).then(() => showToast("Link copied.", "success"), () => showToast(link, "")) }),
          el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "New code", onClick: async () => { await S.newCode(conv.id); draw(); } }),
          el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Close the door", onClick: async () => { await S.closeCode(conv.id); draw(); } }),
        ])
      );
      drawQr(qr, link);
    } else {
      parts.push(
        el("p", { class: "field-hint", text: "No join code. People can only be added by name." }),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Make a join code", onClick: async () => { const c = await S.newCode(conv.id); if (!c) showToast("Couldn't make a code. Is phase 16 applied?"); draw(); } })
      );
    }
    parts.push(
      el("h3", { class: "door-wait-h", text: waiting.length ? `Waiting · ${waiting.length}` : "Nobody waiting" }),
      el(
        "ul",
        { class: "member-list" },
        waiting.map((r) =>
          el("li", {}, [
            el("b", { text: `@${r.username}` }),
            el("span", { class: "faint", text: relTime(Date.parse(r.created_at)) }),
            el("button", {
              type: "button",
              class: "btn btn-primary btn-sm",
              text: "Let in",
              onClick: async (e) => {
                e.currentTarget.disabled = true;
                const res = await S.admit(r);
                if (res.error) showToast(res.error.message);
                else showToast(res.keyShared ? `@${r.username} is in.` : `@${r.username} is in, but couldn't get the room's key. They can ask for it from inside.`, res.keyShared ? "success" : "");
                draw();
              },
            }),
            el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Decline", onClick: async () => { await S.decline(r); draw(); } }),
          ])
        )
      )
    );
    block.replaceChildren(...parts);
  };
  await draw();
  cleanups.push(on("requests", draw));
  // While a host is looking at the door, check it often. (The waiting room
  // is polled, never broadcast -- see phase 17.)
  const poll = setInterval(() => !document.hidden && S.refreshRequests(), 5000);
  cleanups.push(() => clearInterval(poll));
  return block;
}

// QR codes come from a small library loaded only when one is shown. If it
// can't load, the code and link above are enough.
let qrLib = null;
function drawQr(slot, text) {
  const load = () =>
    qrLib ||
    (qrLib = new Promise((resolve, reject) => {
      if (window.qrcode) return resolve(window.qrcode);
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
      s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject());
      s.onerror = reject;
      document.head.append(s);
    }));
  load()
    .then((qrcode) => {
      const q = qrcode(0, "M");
      q.addData(text);
      q.make();
      const n = q.getModuleCount();
      const size = 4;
      const c = document.createElement("canvas");
      c.width = c.height = (n + 8) * size;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#070912";
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + 4) * size, (r + 4) * size, size, size);
      slot.replaceChildren(c);
    })
    .catch(() => {
      qrLib = null;
      slot.remove();
    });
}

// ---- safety --------------------------------------------------------------------------------

async function confirmBlock(userId, username) {
  const ok = await confirmSheet({
    title: `Block @${username || "them"}?`,
    lead: "You won't see their messages anywhere in Panalo, and they won't be able to add you to chats or rooms. They aren't told. You can unblock them from Safety.",
    confirm: "Block",
    danger: true,
  });
  if (!ok) return;
  const { error } = await S.block(userId);
  showToast(error ? "Couldn't block. Is phase 16 applied?" : `@${username || "They"} is blocked.`, error ? "error" : "success");
  if (!error && current) openThread(current.id);
}

export function openReport({ userId, username, conversationId, messageId, evidence }) {
  let reason = "harassment";
  const reasons = chipGroup({
    label: "Reason",
    value: reason,
    options: [
      { id: "harassment", label: "Bullying or harassment" },
      { id: "inappropriate", label: "Inappropriate content" },
      { id: "spam", label: "Spam" },
      { id: "impersonation", label: "Pretending to be someone" },
      { id: "safety", label: "Someone may be in danger" },
      { id: "other", label: "Something else" },
    ],
    onChange: (v) => (reason = v),
  });
  const details = el("textarea", { maxlength: "1000", placeholder: "What happened? (optional)" });
  const include = el("input", { type: "checkbox" });
  const sheet = openSheet({
    title: `Report${username ? ` @${username}` : ""}`,
    lead: "Reports go to the people who run this Panalo. Messages are encrypted, so they can't read the conversation unless you include the text.",
    body: [
      el("div", { class: "field" }, [el("span", { class: "field-label", text: "What's wrong?" }), reasons.node]),
      el("label", { class: "field" }, [el("span", { text: "Details" }), details]),
      evidence ? el("label", { class: "check" }, [include, el("span", { text: "Include this message's text with the report, so it can be checked." })]) : null,
      el("p", { class: "field-hint", text: "If someone is in immediate danger, contact local emergency services or a trusted adult now — a report is not monitored around the clock." }),
    ],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Send report",
        kind: "btn-primary",
        submit: true,
        onClick: async () => {
          const { error } = await S.report({ reason, details: details.value.trim(), evidence: evidence && include.checked ? evidence.slice(0, 4000) : null, reportedUserId: userId, conversationId, messageId });
          showToast(error ? (error.code === "54000" ? error.message : "Couldn't send the report.") : "Report sent. Thank you for telling us.", error ? "error" : "success");
          return !error;
        },
      },
    ],
  });
  return sheet;
}

// ---- starting things ------------------------------------------------------------------------

function openNew(kind = "person") {
  const tabs = chipGroup({
    label: "What to start",
    value: kind,
    options: [
      { id: "person", label: "Message a person" },
      { id: "circle", label: "Form a circle" },
      { id: "room", label: "Open a room" },
    ],
    onChange: (v) => draw(v),
  });
  const slot = el("div", { class: "new-slot" });
  let submit = async () => true;
  const sheet = openSheet({
    title: "Start something",
    body: [tabs.node, slot],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      { label: "Start", kind: "btn-primary", submit: true, onClick: (b) => submit(b) },
    ],
  });

  function draw(v) {
    if (v === "person") {
      const input = el("input", { type: "text", placeholder: "exact username", autocapitalize: "off", spellcheck: "false" });
      slot.replaceChildren(el("label", { class: "field" }, [el("span", { text: "Username" }), el("span", { class: "prefixed" }, [el("i", { text: "@" }), input]), el("small", { class: "field-hint", text: "Nobody can browse the people here. You need their exact username." })]));
      input.focus();
      submit = async (b) => {
        b.disabled = true;
        const r = await S.startDirect(input.value);
        b.disabled = false;
        if (r.error) return showToast(r.error.message), false;
        navigate(`signals/${r.conversation.id}`);
      };
    } else if (v === "circle") {
      const name = el("input", { type: "text", maxlength: "60", placeholder: "e.g. Organic chem crew" });
      let k = "study";
      const kinds = chipGroup({ label: "Kind", value: k, options: S.CONTEXTS.filter((c) => ["crew", "study", "class", "project"].includes(c.id)).map((c) => ({ id: c.id, label: c.label })), onChange: (x) => (k = x) });
      const members = el("input", { type: "text", placeholder: "@maya @priya", autocapitalize: "off", spellcheck: "false" });
      slot.replaceChildren(
        el("label", { class: "field" }, [el("span", { text: "Name" }), name]),
        el("div", { class: "field" }, [el("span", { class: "field-label", text: "What's it for?" }), kinds.node]),
        el("label", { class: "field" }, [el("span", { text: "Who's in it" }), members, el("small", { class: "field-hint", text: "Exact usernames, separated by spaces. You can add more later — or make a join code." })])
      );
      name.focus();
      submit = async (b) => {
        b.disabled = true;
        const { found, missing } = await S.resolveUsernames(members.value);
        if (missing.length) {
          b.disabled = false;
          showToast(`Not found: ${missing.map((m) => "@" + m).join(", ")}. Usernames have to match exactly.`);
          return false;
        }
        const r = await S.createCircle({ name: name.value, kind: k, members: found });
        b.disabled = false;
        if (r.error) return showToast(r.error.message), false;
        if (r.refused?.length) showToast(`Couldn't add ${r.refused.map((u) => "@" + u).join(", ")}.`, "");
        navigate(`signals/${r.conversation.id}`);
      };
    } else {
      const name = el("input", { type: "text", maxlength: "60", placeholder: "e.g. Model UN — Day 2" });
      const ends = el("input", { type: "datetime-local" });
      const d = new Date(Date.now() + 6 * 3600000);
      d.setMinutes(0, 0, 0);
      const p = (n) => String(n).padStart(2, "0");
      ends.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
      let posting = "everyone";
      const post = chipGroup({ label: "Who can post", value: posting, options: [{ id: "everyone", label: "Everyone" }, { id: "hosts", label: "Only hosts" }], onChange: (x) => (posting = x) });
      slot.replaceChildren(
        el("p", { class: "field-hint", text: "A room is for an event: a fest, a hackathon, a trip, a workshop. People join with a code, you let them in, and the room ends on its own." }),
        el("label", { class: "field" }, [el("span", { text: "Room name" }), name]),
        el("label", { class: "field" }, [el("span", { text: "Ends" }), ends, el("small", { class: "field-hint", text: "Up to 60 days from now. After it ends it disappears for everyone, and is deleted a day later." })]),
        el("div", { class: "field" }, [el("span", { class: "field-label", text: "Who can post" }), post.node])
      );
      name.focus();
      submit = async (b) => {
        const at = new Date(ends.value);
        if (!(at > new Date())) return showToast("Pick an end time in the future."), false;
        b.disabled = true;
        const r = await S.createRoom({ name: name.value, endsAt: at, posting });
        b.disabled = false;
        if (r.error) return showToast(r.error.message), false;
        navigate(`signals/${r.conversation.id}`);
        setTimeout(() => openInfo(r.conversation), 400);
      };
    }
  }
  draw(kind);
  return sheet;
}

function openJoin(prefill = "") {
  const input = el("input", { type: "text", class: "code-input num", maxlength: "9", placeholder: "ABCD-2345", value: prefill, autocapitalize: "characters", spellcheck: "false", autocomplete: "off" });
  openSheet({
    title: "Join a room",
    lead: "Enter the code from the organiser. A host will let you in.",
    body: [el("label", { class: "field" }, [el("span", { text: "Join code" }), input])],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Ask to join",
        kind: "btn-primary",
        submit: true,
        onClick: async (b) => {
          b.disabled = true;
          const r = await S.requestToJoin(input.value);
          b.disabled = false;
          if (r.error) return showToast(r.error.message), false;
          if (r.status === "invalid") return showToast("That code doesn't open anything. It may have ended or been changed."), false;
          if (r.status === "member") {
            await S.refreshConversations();
            navigate(`signals/${r.conversation_id}`);
            return true;
          }
          setDoor(r.conversation_id, r.name || "A room");
          renderList();
          showToast(`You're at the door of “${r.name}”. A host will let you in.`, "success");
          navigate("signals");
        },
      },
    ],
  });
}

// When a room I was waiting for lets me in, it shows up in my list.
function settleDoors() {
  for (const [id, name] of Object.entries(doors())) {
    if (store.conversations.some((c) => c.id === id)) {
      setDoor(id, null);
      showToast(`You're in: ${name}.`, "success");
    }
  }
}

// ---- surface lifecycle -------------------------------------------------------------------

export function mount(section, ctx) {
  navigate = ctx.navigate;
  root = el("div", { class: "signals" });
  const search = el("input", { type: "search", class: "input", placeholder: "Find a conversation", "aria-label": "Find a conversation" });
  search.addEventListener("input", () => {
    filter.text = search.value;
    renderList();
  });
  listEl = el("aside", { class: "sig-list", "aria-label": "Conversations" }, [
    el("div", { class: "s-head sig-head" }, [
      el("div", {}, [el("p", { class: "kicker toned tone-signal", text: "Signals" }), el("h1", { text: "Who's out there" })]),
      el("div", { class: "s-actions" }, [
        el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Join with code", onClick: () => openJoin() }),
        el("button", { type: "button", class: "btn btn-primary btn-sm", text: "New", onClick: () => openNew() }),
      ]),
    ]),
    search,
    el("div", { class: "sig-chips-slot" }),
    el("div", { class: "sig-body" }, [el("div", { class: "loading-line" })]),
  ]);
  paneEl = el("div", { class: "thread-pane" });
  root.append(listEl, paneEl);
  section.append(root);

  unsubs.push(
    on("signals", () => {
      settleDoors();
      renderList();
      if (current) {
        const fresh = store.conversations.find((c) => c.id === current.id);
        if (!fresh) {
          current = null;
          S.setOpenConversation(null);
          navigate("signals");
        } else current = fresh;
      }
    }),
    on("requests", renderList),
    S.onLiveMessage(async (msg, deletedId) => {
      if (deletedId) return document.getElementById(`m-${deletedId}`)?.remove();
      if (!thread || !current || msg.conversation_id !== current.id) return;
      const stick = nearBottom();
      msg._plain = msg.content ? await messagePlaintext(msg) : "";
      thread.list.querySelector(".thread-empty")?.remove();
      appendMessage(msg);
      if (stick || msg.user_id === state.currentUser.id) toBottom();
    })
  );
  setPresenceListener(() => renderList());
  if (store.conversations.length) renderList();
}

export function show(param) {
  if (!param) {
    current = null;
    thread = null;
    S.setOpenConversation(null);
    root.classList.remove("thread-open");
    paneEl.replaceChildren(
      el("div", { class: "thread-idle" }, [
        el("p", { class: "serif idle-line", text: "Pick a star." }),
        el("p", { class: "faint", text: "Messages and files are encrypted on your device. No phone numbers, ever." }),
      ])
    );
    renderList();
    return;
  }
  if (param === "new") {
    show(null);
    return openNew();
  }
  if (param === "join" || param.startsWith("join=")) {
    show(null);
    return openJoin(param.startsWith("join=") ? param.slice(5) : "");
  }
  openThread(param);
}

export function hide() {
  S.setOpenConversation(null);
  current = null;
}

export function destroy() {
  unsubs.forEach((u) => u());
  unsubs = [];
  current = null;
  thread = null;
}
