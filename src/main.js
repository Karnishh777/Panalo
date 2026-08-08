// Entry point: wire up the chat UI, then the auth UI (which also restores any
// existing session). crypto.js and the Supabase SDK are loaded as classic scripts
// before this module, so window.PanaloCrypto and window.supabase already exist.
import { initChatUI } from "./chat.js";
import { initAuth } from "./auth.js";

initChatUI();
initAuth();
