// Shared interface pieces for Panalo Students: sheets (dialogs), confirm,
// menus, small builders. Rendering goes through src/util.js `el()`, which
// assigns text with textContent -- user content is never parsed as HTML.
import { el, showToast as pageToast } from "../../src/util.js";

export { el };

// Messages must be seen where the person is looking. A modal sheet puts
// the rest of the page under a backdrop and makes it inert, so a toast in
// the page would be dimmed and skipped by screen readers. While a sheet is
// open, errors appear inside it, as an alert; everything else is raised
// into the top layer (a popover), above any sheet.
export function showToast(message, type = "error") {
  const open = [...document.querySelectorAll("dialog[open]")].pop();
  if (open && type === "error") {
    let slot = open.querySelector(".sheet-alert");
    if (!slot) {
      slot = el("p", { class: "sheet-alert", role: "alert" });
      (open.querySelector(".sheet-body") || open).prepend(slot);
    }
    slot.textContent = "";
    // Re-set on the next frame so a repeated message is announced again.
    requestAnimationFrame(() => (slot.textContent = message));
    return;
  }
  pageToast(message, type);
  const box = document.getElementById("toast-container");
  if (box && typeof box.showPopover === "function") {
    if (!box.hasAttribute("popover")) box.setAttribute("popover", "manual");
    try {
      if (box.matches(":popover-open")) box.hidePopover();
      box.showPopover();
    } catch {
      /* older browsers: the toast still shows in the page */
    }
  }
}

let sheetCount = 0;

/**
 * A modal sheet built on <dialog>: native focus containment and Escape,
 * focus returned to whatever opened it, a bottom sheet on phones.
 * @param {{title: string, lead?: string, body?: Node|Node[], actions?: Array<{label: string, kind?: string, onClick?: Function, close?: boolean, id?: string}>, wide?: boolean, onClose?: Function, form?: boolean}} opts
 */
export function openSheet({ title, lead, body = [], actions = [], wide = false, onClose, form = true } = {}) {
  const id = `sheet-${++sheetCount}`;
  const opener = document.activeElement;
  const dialog = el("dialog", { class: `sheet${wide ? " wide" : ""}`, "aria-labelledby": `${id}-t` });
  const content = el(form ? "form" : "div", { class: "sheet-inner", novalidate: form ? "" : null, method: form ? "dialog" : null });
  const closeBtn = el("button", { class: "icon-btn sm", type: "button", "aria-label": "Close", text: "✕", onClick: () => close() });
  const head = el("div", { class: "sheet-head" }, [
    el("div", { style: "flex:1" }, [el("h2", { id: `${id}-t`, text: title }), lead ? el("p", { text: lead }) : null]),
    closeBtn,
  ]);
  const bodyEl = el("div", { class: "sheet-body" }, [].concat(body));
  const foot = actions.length ? el("div", { class: "sheet-foot" }) : null;
  const buttons = {};
  for (const a of actions) {
    const b = el("button", {
      class: `btn ${a.kind || "btn-ghost"}`,
      type: a.submit ? "submit" : "button",
      id: a.id || null,
      text: a.label,
    });
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      if (a.onClick) {
        const result = await a.onClick(b, e);
        if (result === false) return;
      }
      if (a.close !== false) close();
    });
    buttons[a.label] = b;
    foot.append(b);
  }
  content.append(head, bodyEl);
  if (foot) content.append(foot);
  dialog.append(content);
  // Enter in a field submits through the primary action, not a page reload.
  content.addEventListener("submit", (e) => {
    e.preventDefault();
    const primary = actions.find((a) => a.submit) || actions.find((a) => (a.kind || "").includes("primary"));
    if (primary) buttons[primary.label].click();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close(); // the backdrop
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose?.();
    if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  const first = bodyEl.querySelector("input, select, textarea, button");
  if (first) first.focus();

  function close() {
    if (dialog.open) dialog.close();
  }
  return { dialog, body: bodyEl, close, buttons };
}

export function confirmSheet({ title, lead, confirm = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      lead,
      form: false,
      actions: [
        { label: "Cancel", kind: "btn-quiet", onClick: () => { answered = true; resolve(false); } },
        { label: confirm, kind: danger ? "btn-danger" : "btn-primary", onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => !answered && resolve(false),
    });
  });
}

// A labelled field. `input` may be an element or a props object.
export function field(label, input, hint) {
  const control = input.nodeType ? input : el(input.tag || "input", { ...input, tag: null });
  return el("label", { class: "field" }, [el("span", { text: label }), control, hint ? el("small", { class: "field-hint", text: hint }) : null]);
}

// A row of single-choice chips (radiogroup semantics).
export function chipGroup({ label, options, value, onChange, toneOf }) {
  const group = el("div", { class: "chips", role: "radiogroup", "aria-label": label });
  let current = value;
  const render = () => {
    group.replaceChildren(
      ...options.map((o) =>
        el("button", {
          type: "button",
          class: `chip ${toneOf ? toneOf(o.id) : ""}`,
          role: "radio",
          "aria-checked": String(o.id === current),
          text: o.label,
          onClick: () => {
            current = o.id;
            render();
            onChange?.(o.id);
          },
        })
      )
    );
  };
  render();
  return { node: group, get value() { return current; } };
}

// A simple dropdown menu anchored to a button. Escape and outside clicks
// close it; arrow keys move between items.
export function popMenu(anchor, items) {
  document.querySelectorAll(".menu.pop").forEach((m) => m.remove());
  const menu = el("div", { class: "menu pop", role: "menu" });
  for (const it of items) {
    if (!it) continue;
    menu.append(
      el("button", {
        type: "button",
        role: "menuitem",
        class: it.danger ? "danger" : "",
        text: it.label,
        onClick: () => {
          menu.remove();
          it.onClick();
        },
      })
    );
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = Math.max(200, menu.offsetWidth);
  menu.style.top = `${Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 6)}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))}px`;
  const buttons = [...menu.querySelectorAll("button")];
  buttons[0]?.focus();
  const onKey = (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "Escape") { close(); anchor.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
  };
  const onDown = (e) => {
    if (!menu.contains(e.target) && e.target !== anchor) close();
  };
  function close() {
    menu.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onDown, true);
  }
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onDown, true);
  return close;
}

export function emptyState(title, text, action) {
  return el("div", { class: "empty" }, [el("h3", { text: title }), el("p", { text }), action || null]);
}

// "Tue 14 Oct", in the reader's locale.
export function shortDate(d) {
  return new Date(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function longDate(d) {
  return new Date(d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

// For <input type="datetime-local"> / "date" / "time", in local time.
export function toLocalInput(d, kind = "datetime-local") {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  const date = `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  const time = `${p(x.getHours())}:${p(x.getMinutes())}`;
  return kind === "date" ? date : kind === "time" ? time : `${date}T${time}`;
}

// Report an error from Supabase in words a person can use.
export function reportError(error, fallback = "Something went wrong. Try again.") {
  if (!error) return;
  console.error(error);
  const msg = error.message || "";
  if (error.code === "54000" || /limit|too many|full/i.test(msg)) showToast(msg);
  else if (/network|fetch/i.test(msg)) showToast("You seem to be offline. Nothing was saved.");
  else showToast(fallback);
}

// Persisted per-device conveniences (never anything that must sync).
const PREFS_KEY = "panalo.students.prefs";
export function getPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the preference lasts this session only */
  }
  return next;
}
