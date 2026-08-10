// Central configuration — a single home for all constants (no magic values elsewhere).

// Supabase credentials. The anon/publishable key is safe in the frontend because
// Row-Level Security (see supabase-setup.sql) governs all access.
export const SUPABASE_URL = "https://zqtvqobonmpxffjxbjpt.supabase.co";
export const SUPABASE_KEY = "sb_publishable_TQ1NrHUU3HaIcFRkOWXHuQ_yC3REquy";

// A message image URL must start with this to be rendered (blocks injection +
// off-origin beacons).
export const STORAGE_URL_PREFIX = `${SUPABASE_URL}/storage/`;

// Session persistence preference key ("Keep me logged in").
export const REMEMBER_KEY = "panalo.remember";

export const MIN_PASSWORD_LENGTH = 6;
export const OTP_LENGTH = 6;

export const AVATAR_COLORS = [
  "#00d69b", "#6fd3ff", "#ffb86f", "#ff8888", "#c792ff", "#ffe066", "#7ef2c2", "#ff9ecb",
];

// Messages loaded per page (recent first; older fetched on scroll-up).
export const MESSAGES_PAGE_SIZE = 30;

// Client-side image compression targets.
export const MAX_IMAGE_DIMENSION = 1600;
export const IMAGE_QUALITY = 0.8;
export const COMPRESS_MIN_BYTES = 200 * 1024;

// Per-chat themes — each preset recolors the chat area (sent bubbles, accents).
export const THEME_PRESETS = [
  { id: "default", name: "Violet", primary: "#8b7cf6", strong: "#6c5ce7" },
  { id: "sunset", name: "Sunset", primary: "#ff8a5b", strong: "#ff5e7e" },
  { id: "ocean", name: "Ocean", primary: "#37c2e0", strong: "#3a7bd5" },
  { id: "forest", name: "Forest", primary: "#4ecb71", strong: "#2fa060" },
  { id: "rose", name: "Rose", primary: "#ff6fae", strong: "#e0559a" },
  { id: "slate", name: "Slate", primary: "#9aa4b8", strong: "#6b7688" },
];

// Chat background presets (applied to .chat-main via a data-wallpaper attribute).
export const WALLPAPER_PRESETS = [
  { id: "dots", name: "Dots" },
  { id: "aurora", name: "Aurora" },
  { id: "mesh", name: "Mesh" },
  { id: "plain", name: "Plain" },
  { id: "custom", name: "📷 Upload" },
];
