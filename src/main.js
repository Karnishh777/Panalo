// Entry point: wire up the chat UI, then the auth UI (which also restores any
// existing session). crypto.js and the Supabase SDK are loaded as classic scripts
// before this module, so window.PanaloCrypto and window.supabase already exist.
import { initChatUI } from "./chat.js";
import { initAuth } from "./auth.js";
import { initSettings } from "./settings.js";
import { initProfile } from "./profile.js";
import { hydrateIcons } from "./icons.js";
import { setFocusMode } from "./chat.js";
import { setServiceWorker } from "./notifications.js";
import { enforceAppLock } from "./lock.js";

hydrateIcons(); // swap every <span data-icon> for its themed vector icon
enforceAppLock(); // if a PIN guards the app, ask for it before anything shows
initChatUI();
initAuth();
initSettings();
initProfile();

// Service worker: offline shell, installability, and — the reason it matters
// day to day — notifications that reach the OS notification centre instead of
// being discarded when the tab loses focus.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(setServiceWorker)
      .catch(() => {
        /* the app works without it; alerts fall back to the page */
      });
  });

  // Tapping a notification asks the page to open that conversation.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "open-chat" || !event.data.conversationId) return;
    document.dispatchEvent(
      new CustomEvent("panalo:open-chat", { detail: { conversationId: event.data.conversationId } })
    );
  });
}

// Accessibility: Escape closes the dismissable modals (not the unlock modal).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.getElementById("direct-modal")?.classList.add("hidden");
  document.getElementById("group-modal")?.classList.add("hidden");
  document.getElementById("theme-modal")?.classList.add("hidden");
  document.getElementById("settings-modal")?.classList.add("hidden");
  document.getElementById("image-viewer")?.classList.add("hidden");
  document.getElementById("members-modal")?.classList.add("hidden");
  document.getElementById("chat-menu")?.classList.add("hidden");
  document.getElementById("profile-modal")?.classList.add("hidden");
  document.getElementById("edit-modal")?.classList.add("hidden");
  document.getElementById("pinned-modal")?.classList.add("hidden");
  document.getElementById("new-chat-modal")?.classList.add("hidden");
  document.getElementById("cancel-reply")?.click();
  document.getElementById("chat-info")?.classList.remove("open");
  setFocusMode(false);
});
