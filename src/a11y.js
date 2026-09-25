// Keyboard and screen-reader behaviour for every dialog, menu and popover.
//
// The app opens dialogs by removing `.hidden` from them (and a few are built
// on the fly: confirmations, the tour). Rather than touch every one of those
// call sites, this watches the DOM and, for whichever dialog is on top:
//   - moves focus into it when it opens, and back to where you were when it
//     closes;
//   - keeps Tab inside it while it's open;
//   - makes Escape close it by pressing its own Cancel/Close button, so the
//     dialog's cleanup runs exactly as if you'd clicked it.
// A dialog marked data-persistent (unlock, password recovery, a PIN prompt
// that can't be cancelled, an active call) is never closed by Escape, and a
// dismiss button that isn't visible is never pressed -- that is how an app
// lock stays a lock.
const DIALOG_SELECTOR = ".modal, .image-viewer, .call-overlay, .tour-overlay, [role='dialog'][aria-modal='true']";
const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1']), summary";

// Menus/popovers Escape closes when no dialog is open, most specific first.
const POPOVERS = ["#chat-menu", "#compose-menu", "#emoji-panel", "#sticker-panel"];

const stack = []; // [{ el, returnTo }]
let keyboardMode = false;

const visible = (el) => !!el && el.isConnected && !el.classList.contains("hidden") && el.getClientRects().length > 0;

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length > 0 && !n.closest(".hidden"));
}

function isOpenDialog(el) {
  return el.matches?.(DIALOG_SELECTOR) && visible(el);
}

function onOpen(el) {
  if (stack.some((d) => d.el === el)) return;
  const returnTo = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  stack.push({ el, returnTo });
  // Let the dialog's own code focus something first (many do); only step in
  // if focus is still outside it.
  setTimeout(() => {
    if (!visible(el) || el.contains(document.activeElement)) return;
    const target =
      el.querySelector("[autofocus]") ||
      focusables(el).find((n) => n.matches("input, textarea")) ||
      focusables(el)[0];
    target?.focus({ preventScroll: true });
  }, 60);
}

function onClose(el) {
  const i = stack.findIndex((d) => d.el === el);
  if (i < 0) return;
  const [{ returnTo }] = stack.splice(i, 1);
  // Only restore if focus was lost (i.e. it was inside the dialog), and to
  // something that still exists and can take it.
  const lost = !document.activeElement || document.activeElement === document.body || el.contains(document.activeElement);
  if (lost && returnTo?.isConnected && visible(returnTo)) returnTo.focus({ preventScroll: true });
}

function scan() {
  // Dialogs that closed or were removed.
  for (const d of [...stack]) if (!isOpenDialog(d.el)) onClose(d.el);
  // Dialogs that opened, in document order (later ones stack on top).
  document.querySelectorAll(DIALOG_SELECTOR).forEach((el) => {
    if (isOpenDialog(el)) onOpen(el);
  });
  syncExpanded();
}

// aria-expanded on the buttons that open menus.
const EXPANDERS = [
  ["chat-menu-btn", "chat-menu"],
  ["compose-add", "compose-menu"],
  ["emoji-btn", "emoji-panel"],
  ["sticker-btn", "sticker-panel"],
];
function syncExpanded() {
  for (const [btnId, panelId] of EXPANDERS) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (btn && panel) btn.setAttribute("aria-expanded", String(visible(panel)));
  }
}

function topDialog() {
  for (let i = stack.length - 1; i >= 0; i--) if (isOpenDialog(stack[i].el)) return stack[i].el;
  return null;
}

function handleEscape(e) {
  const dialog = topDialog();
  if (dialog) {
    // These manage their own Escape.
    if (dialog.matches(".tour-overlay, .confirm-modal")) return;
    e.preventDefault();
    if (dialog.hasAttribute("data-persistent")) return;
    const btn = dialog.dataset.dismiss && document.getElementById(dialog.dataset.dismiss);
    if (btn && visible(btn)) btn.click();
    return;
  }

  // No dialog: close the innermost open thing, one per press.
  const popup = document.querySelector(".msg-actions, .reaction-picker, .mention-picker");
  if (popup) {
    popup.remove();
    return;
  }
  for (const sel of POPOVERS) {
    const el = document.querySelector(sel);
    if (visible(el)) {
      el.classList.add("hidden");
      syncExpanded();
      const opener = EXPANDERS.find(([, p]) => `#${p}` === sel)?.[0];
      document.getElementById(opener)?.focus();
      return;
    }
  }
  const drawer = document.getElementById("chat-info");
  if (drawer?.classList.contains("open")) {
    document.getElementById("close-chat-info")?.click();
    return;
  }
  const reply = document.getElementById("reply-bar");
  if (visible(reply)) {
    document.getElementById("cancel-reply")?.click();
    return;
  }
  if (document.body.classList.contains("focus-mode")) {
    document.getElementById("focus-exit-btn")?.click();
  }
}

function trapTab(e) {
  const dialog = topDialog();
  if (!dialog) return;
  const items = focusables(dialog);
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!dialog.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

// Arrow keys move between items of an open menu.
function menuArrows(e) {
  const menu = e.target.closest?.("[role='menu'], [role='listbox']");
  if (!menu) return;
  const items = [...menu.querySelectorAll("[role='menuitem'], [role='option']")].filter((n) => n.getClientRects().length);
  const i = items.indexOf(document.activeElement);
  if (!items.length) return;
  e.preventDefault();
  const next = e.key === "ArrowDown" ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length];
  next.focus();
}

// Only mutations that can open or close a dialog or menu are worth a scan;
// the message list alone changes classes constantly.
const WATCHED = `${DIALOG_SELECTOR}, #chat-menu, #compose-menu, #emoji-panel, #sticker-panel`;
function relevant(record) {
  if (record.type === "attributes") return record.target.matches?.(WATCHED);
  for (const n of [...record.addedNodes, ...record.removedNodes]) {
    if (n.nodeType === 1 && n.matches(DIALOG_SELECTOR)) return true;
  }
  return false;
}

export function initA11y() {
  new MutationObserver((records) => {
    if (records.some(relevant)) scan();
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      keyboardMode = true;
      document.documentElement.classList.add("kbd");
      trapTab(e);
    } else if (e.key === "Escape") {
      handleEscape(e);
    } else if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("button, [role='button']")) {
      // Activating a button from the keyboard.
      keyboardMode = true;
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      menuArrows(e);
    }
  });
  document.addEventListener("pointerdown", () => {
    keyboardMode = false;
    document.documentElement.classList.remove("kbd");
  }, { passive: true });

  // A menu opened from the keyboard should put focus on its first item.
  for (const [btnId, panelId] of EXPANDERS.slice(0, 2)) {
    document.getElementById(btnId)?.addEventListener("click", () => {
      if (!keyboardMode) return;
      setTimeout(() => {
        const panel = document.getElementById(panelId);
        if (visible(panel)) panel.querySelector("[role='menuitem']")?.focus();
      }, 0);
    });
  }

  scan();
}
