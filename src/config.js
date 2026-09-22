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

// Password policy. These MUST match Authentication → Sign In / Providers →
// Email in the Supabase dashboard, which is where the rule is actually
// enforced. The client checks the same thing only so the user finds out
// while typing rather than after submitting.
//
// Supabase's own guidance: anything under 8 characters is not recommended.
export const MIN_PASSWORD_LENGTH = 8;
// Character classes a password must contain, matching the dashboard's
// "Required characters" setting — currently none, so length is the only rule.
//
// Empty is deliberate, not an oversight. The client must never be STRICTER
// than the server: requiring a symbol here while Supabase happily accepts
// "correcthorsebatterystaple" would refuse a genuinely strong passphrase and
// leave the user no way to understand why. Composition rules also push people
// toward predictable shapes like "Password1!", which is why current NIST
// guidance (SP 800-63B) favours length over mandatory character classes.
//
// If "Required characters" is ever enabled in the dashboard, add the matching
// entries here: "lower", "upper", "digit", "symbol".
export const PASSWORD_REQUIRED_CLASSES = [];
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
// Colors are deliberately muted (not neon) so every option reads matte.
export const THEME_PRESETS = [
  { id: "default", name: "Ember", primary: "#e2582e", strong: "#c2431f" },
  { id: "sunset", name: "Sunset", primary: "#d97a48", strong: "#b85f34" },
  { id: "ocean", name: "Ocean", primary: "#3f9db0", strong: "#2f7c8c" },
  { id: "forest", name: "Forest", primary: "#5a9e6a", strong: "#437c50" },
  { id: "rose", name: "Rose", primary: "#c46a89", strong: "#a1516c" },
  { id: "slate", name: "Slate", primary: "#8a8478", strong: "#6b6559" },
];

// Per-chat font presets (personal, stored locally). "stack" is the CSS value
// applied to the chat area via the --chat-font custom property.
export const FONT_PRESETS = [
  { id: "default", name: "Classic", stack: "'Inter', 'Segoe UI', system-ui, sans-serif" },
  { id: "rounded", name: "Rounded", stack: "'Quicksand', 'Segoe UI', sans-serif" },
  { id: "elegant", name: "Elegant", stack: "'Lora', Georgia, serif" },
  { id: "mono", name: "Hacker", stack: "'JetBrains Mono', Consolas, monospace" },
  { id: "cyber", name: "Cyber", stack: "'Orbitron', 'Segoe UI', sans-serif" },
  { id: "comic", name: "Comic", stack: "'Comic Neue', 'Comic Sans MS', cursive" },
];

// Ambient background effects (Settings → Effects). "aurora" is the CSS layer;
// "tech" renders on the fx canvas (see effects.js). Trimmed down to the two
// that read as premium/matte rather than glossy — "liquid" and "bubbles"
// were dropped for clashing with the matte direction.
export const EFFECT_PRESETS = [
  { id: "aurora", name: "Aurora" },
  { id: "tech", name: "Tech" },
  { id: "image", name: "Upload", icon: "upload" },
  { id: "none", name: "None" },
];

// Any-file attachments: hard cap (also Supabase free-tier per-file limit).
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Chat background presets (applied to .chat-main via a data-wallpaper attribute).
// "aurora" and "mesh" were dropped — both were rainbow gradient-blob patterns
// that clashed with the matte direction.
export const WALLPAPER_PRESETS = [
  { id: "doodle", name: "Doodle" },
  // "Ambient" makes the app translucent so the ambient effect shows through it.
  { id: "ambient", name: "Ambient", icon: "sparkle" },
  { id: "dots", name: "Dots" },
  { id: "plain", name: "Plain" },
  { id: "custom", name: "Upload", icon: "upload" },
];
