// Entry point: wire up the public pages, the chat UI, then the auth UI (which
// also restores any existing session). crypto.js and the Supabase SDK are
// loaded as classic scripts before this module, so window.PanaloCrypto and
// window.supabase already exist.
import { initChatUI } from "./chat.js";
import { initAuth } from "./auth.js";
import { initSettings } from "./settings.js";
import { initProfile } from "./profile.js";
import { hydrateIcons } from "./icons.js";
import { setServiceWorker } from "./notifications.js";
import { enforceAppLock } from "./lock.js";
import { startConnectionWatch } from "./connection.js";
import { initPublic } from "./public.js";
import { initA11y } from "./a11y.js";
import { initHome } from "./home.js";

hydrateIcons(); // swap every <span data-icon> for its themed vector icon
initSettings(); // theme, accent and fonts first, so nothing repaints later
initA11y(); // focus management + Escape for every dialog and menu
startConnectionWatch(); // surface offline/reconnecting/syncing, and recover from gaps
enforceAppLock(); // if a PIN guards the app, ask for it before anything shows
initPublic();
initChatUI();
initHome();
initAuth();
initProfile();

// Every <form> here is handled in JS; none should ever navigate. Buttons do
// their own work in click handlers (Enter in a field "clicks" the form's
// submit button), so this only has to stop the page reload.
document.addEventListener("submit", (e) => e.preventDefault());

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
