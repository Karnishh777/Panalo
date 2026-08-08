import { SUPABASE_URL, SUPABASE_KEY, REMEMBER_KEY } from "./config.js";

// "Keep me logged in" routes the auth session to localStorage (survives browser
// restarts) vs sessionStorage (cleared when the tab/browser closes). Default is
// to remember. All storage access is guarded so private mode never breaks auth.
function rememberEnabled() {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "false";
  } catch {
    return true;
  }
}

const authStorage = {
  getItem: (key) => {
    try {
      const value = localStorage.getItem(key);
      return value !== null ? value : sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      if (rememberEnabled()) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    } catch {
      /* storage unavailable — the session simply won't persist */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export function setRemember(value) {
  try {
    localStorage.setItem(REMEMBER_KEY, value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
