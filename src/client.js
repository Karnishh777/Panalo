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

// Resolve exactly one username to a profile.
//
// This used to be `select ... from profiles where username ilike ?`, which
// worked because the read policy was `using (true)` -- every signed-in
// account could read every profile in the system. That made the whole user
// list downloadable by anyone who signed up. The policy is now scoped to
// yourself and people you share a chat with, so a stranger lookup has to go
// through this instead: exact name in, at most one row out, no pattern
// matching and nothing to iterate over.
//
// Returns { id, username, public_key } or null.
export async function findProfileByUsername(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const { data, error } = await supabaseClient.rpc("find_profile_by_username", { name: trimmed });
  if (error) throw error;
  return (data && data[0]) || null;
}
