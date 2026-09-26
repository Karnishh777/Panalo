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

// Messages loaded per page (recent first; older fetched on scroll-up).
export const MESSAGES_PAGE_SIZE = 30;

// Client-side image compression targets.
export const MAX_IMAGE_DIMENSION = 1600;
export const IMAGE_QUALITY = 0.8;
export const COMPRESS_MIN_BYTES = 200 * 1024;

// Accents: the app-wide colour (Settings) and each chat's own theme (stored in
// conversations.theme, so the ids are a contract with every existing chat --
// never rename one). `primary` carries white text at WCAG AA (>= 4.5:1);
// every lighter/darker shade is derived from it in css/tokens.css.
export const THEME_PRESETS = [
  { id: "default", name: "Ember", primary: "#d83b17", strong: "#b02c0d" },
  { id: "sunset", name: "Sunset", primary: "#b85a10", strong: "#94470a" },
  { id: "rose", name: "Rose", primary: "#cc2e66", strong: "#a82251" },
  { id: "grape", name: "Grape", primary: "#7b45e0", strong: "#6232bf" },
  { id: "sky", name: "Sky", primary: "#2f6fe4", strong: "#1f57c0" },
  { id: "ocean", name: "Ocean", primary: "#0b7a9e", strong: "#07607d" },
  { id: "forest", name: "Forest", primary: "#1e8250", strong: "#15673f" },
  { id: "slate", name: "Slate", primary: "#56606f", strong: "#414a57" },
];

// Font presets, for the whole app (Settings) or one chat (chat info).
// `google` is the Google Fonts family spec; src/fonts.js loads it the first
// time the font is actually used, so nobody downloads six families to read
// their messages in the default one.
export const FONT_PRESETS = [
  { id: "default", name: "Classic", stack: "'Inter', 'Segoe UI', system-ui, sans-serif" },
  { id: "rounded", name: "Rounded", stack: "'Quicksand', 'Segoe UI', sans-serif", google: "Quicksand:wght@500;700" },
  { id: "elegant", name: "Elegant", stack: "'Lora', Georgia, serif", google: "Lora:ital,wght@0,500;0,700;1,500" },
  { id: "mono", name: "Hacker", stack: "'JetBrains Mono', Consolas, monospace", google: "JetBrains+Mono:wght@400;700" },
  { id: "cyber", name: "Cyber", stack: "'Orbitron', 'Segoe UI', sans-serif", google: "Orbitron:wght@500;700" },
  { id: "comic", name: "Comic", stack: "'Comic Neue', 'Comic Sans MS', cursive", google: "Comic+Neue:wght@400;700" },
];

// Ambient background effects (Settings → Effects). "aurora" is the CSS layer;
// "tech" renders on the fx canvas (see effects.js). Trimmed down to the two
// that read as premium/matte rather than glossy — "liquid" and "bubbles"
// were dropped for clashing with the matte direction.
export const EFFECT_PRESETS = [
  { id: "aurora", name: "Glow" },
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
  { id: "city", name: "Night city", scene: "wallpapers/night-city.svg" },
  { id: "northern", name: "Northern lights", scene: "wallpapers/northern-lights.svg" },
  { id: "galaxy", name: "Galaxy", scene: "wallpapers/galaxy.svg" },
  { id: "dots", name: "Dots" },
  { id: "plain", name: "Plain" },
  // "Ambient" makes the app translucent so the ambient effect shows through it.
  { id: "ambient", name: "Ambient", icon: "sparkle" },
  { id: "custom", name: "Upload", icon: "upload" },
];

// One-tap looks: a theme (light/dark) plus an accent. Picking one just sets
// those two settings, which stay individually adjustable underneath.
export const LOOK_PRESETS = [
  { id: "midnight", name: "Midnight", mode: "dark", accent: "sky" },
  { id: "neon", name: "Neon", mode: "dark", accent: "grape" },
  { id: "ocean", name: "Ocean", mode: "dark", accent: "ocean" },
  { id: "sunset", name: "Sunset", mode: "light", accent: "sunset" },
  { id: "forest", name: "Forest", mode: "dark", accent: "forest" },
  { id: "daylight", name: "Daylight", mode: "light", accent: "default" },
];
