// Entry point: wire up the chat UI, then the auth UI (which also restores any
// existing session). crypto.js and the Supabase SDK are loaded as classic scripts
// before this module, so window.PanaloCrypto and window.supabase already exist.
import { initChatUI } from "./chat.js";
import { initAuth } from "./auth.js";
import { initSettings } from "./settings.js";

initChatUI();
initAuth();
initSettings();

// Accessibility: Escape closes the dismissable modals (not the unlock modal).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.getElementById("direct-modal")?.classList.add("hidden");
  document.getElementById("group-modal")?.classList.add("hidden");
  document.getElementById("theme-modal")?.classList.add("hidden");
  document.getElementById("settings-modal")?.classList.add("hidden");
  document.getElementById("image-viewer")?.classList.add("hidden");
});
