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
