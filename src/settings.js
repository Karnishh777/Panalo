// Per-device "vibe" settings: global accent, chat wallpaper (presets or your own
// image), animated background, and a themed custom cursor. Stored in localStorage
// (UI preferences, no backend needed).
import { THEME_PRESETS, WALLPAPER_PRESETS, EFFECT_PRESETS, FONT_PRESETS } from "./config.js";
import { validatePassword } from "./password.js";
import { el, showToast, withBusy } from "./util.js";
import { icon } from "./icons.js";
import {
  setAlertPrefs,
  requestDesktopPermission,
  sendTestAlert,
  notificationPermission,
} from "./notifications.js";
import { applyEffect } from "./effects.js";
import { hasPin, setPin, appLockEnabled, setAppLock, askPin, SHORTCUT_LABEL } from "./lock.js";
import { startTour } from "./tour.js";
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { rewrapPrivateKey, idbDelKey } from "./encryption.js";
import { confirmDelete } from "./chatinfo.js";
import { deleteAttachment, clearAttachmentCache } from "./attachments.js";
import { mapLimited } from "./util.js";

const SETTINGS_KEY = "panalo.settings";
const DEFAULTS = {
  accent: "default",
  wallpaper: "doodle",
  customWallpaper: null,
  effect: "aurora",
  ambientImage: null,
  appFont: "default",
  cursorGlow: false,
  ogSkin: false, // the original violet palette, kept as an option
  notifications: false, // desktop (needs browser permission)
  inAppAlerts: true, // always works
  alertSound: true,
};

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    // Migrate the old boolean "animatedBg" toggle to the effect selector.
    if (stored.animatedBg === false && !stored.effect) stored.effect = "none";
    delete stored.animatedBg;
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}
function save() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Likely quota (a big custom wallpaper) — the setting still applies this session.
    showToast("Couldn't save that wallpaper (too large). It'll reset on reload.", "");
  }
}

const settings = load();

// ---- Accent ----
// A brown→tan gradient built from the preset's one stored color, so every
// preset (and the default) gets a matching two-tone fill.
// The OG skin is a palette swap driven by one attribute on <html>, so it can
// be flipped instantly with no reload and no second stylesheet to keep in
// step with the first.
function applySkin(on) {
  document.documentElement.setAttribute("data-skin", on ? "og" : "matte");
}

const ACCENT_VARS = ["--primary", "--primary-strong", "--grad", "--bubble-out"];

function applyAccent(id) {
  const root = document.documentElement.style;

  // These are written as INLINE properties on <html>, which outrank any
  // stylesheet rule including the skin's. Left unconditional, picking the OG
  // skin gave you a violet app with an orange send button, because the
  // default accent kept overriding the violet the skin defines.
  //
  // "Default" now means "whatever this skin says": clear the overrides and
  // let the stylesheet decide. An accent the user actually chose is still
  // honoured on either skin -- that is their call, not a bug.
  if (settings.ogSkin && (!id || id === "default")) {
    ACCENT_VARS.forEach((v) => root.removeProperty(v));
    return;
  }

  const p = THEME_PRESETS.find((t) => t.id === id) || THEME_PRESETS[0];
  const grad = `linear-gradient(135deg, ${p.primary}, color-mix(in srgb, ${p.primary} 55%, white))`;
  root.setProperty("--primary", p.primary);
  root.setProperty("--primary-strong", p.strong);
  root.setProperty("--grad", grad);
  root.setProperty("--bubble-out", grad);
}

// ---- App font ----
// "default" restores the Sora + Inter mix; any preset takes over app-wide,
// so all existing text (headers, buttons, chats) follows the choice.
function applyAppFont(id) {
  const root = document.documentElement.style;
  const preset = FONT_PRESETS.find((f) => f.id === id);
  if (!preset || id === "default") {
    root.removeProperty("--font-ui");
    root.removeProperty("--font-display");
    return;
  }
  root.setProperty("--font-ui", preset.stack);
  root.setProperty("--font-display", preset.stack);
}

// ---- Wallpaper ----
function applyWallpaper(id) {
  const container = document.querySelector(".app-container");
  if (!container) return;
  container.dataset.wallpaper = id;
  if (id === "custom" && settings.customWallpaper) {
    // Dark overlay keeps text readable over any photo.
    container.style.backgroundImage =
      `linear-gradient(rgba(17,15,12,0.55), rgba(17,15,12,0.7)), url(${settings.customWallpaper})`;
  } else {
    container.style.removeProperty("background-image"); // let the CSS preset apply
  }
}

// Downscale + re-encode an uploaded image so it fits comfortably in localStorage.
async function imageToWallpaperDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const maxDim = 1280;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.72);
}

// ---- Custom cursor (themed ring + soft glow trail; desktop only) ----
let dotEl = null;
let glowEl = null;
let glowRAF = 0;
let cursorOn = false;
let mx = 0;
let my = 0;
let gx = 0;
let gy = 0;

function onPointerMove(e) {
  mx = e.clientX;
  my = e.clientY;
  if (dotEl) {
    dotEl.style.left = `${mx}px`;
    dotEl.style.top = `${my}px`;
  }
}
function onPointerOver(e) {
  if (!dotEl || !e.target.closest) return;
  const interactive = e.target.closest(
    'button, a, [role="button"], .conv-item, .quick-btn, .theme-swatch, .wallpaper-chip, input, label, .switch'
  );
  dotEl.classList.toggle("big", !!interactive);
}
function glowLoop() {
  gx += (mx - gx) * 0.18;
  gy += (my - gy) * 0.18;
  if (glowEl) glowEl.style.transform = `translate(${gx}px, ${gy}px) translate(-50%, -50%)`;
  glowRAF = requestAnimationFrame(glowLoop);
}
function applyCursor(on) {
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const enable = on && finePointer;

  if (enable && !cursorOn) {
    if (!dotEl) {
      dotEl = document.createElement("div");
      dotEl.id = "cursor-dot";
      document.body.append(dotEl);
    }
    if (!glowEl) {
      glowEl = document.createElement("div");
      glowEl.id = "cursor-glow";
      document.body.append(glowEl);
    }
    dotEl.style.display = "block";
    document.body.classList.add("custom-cursor");
    window.addEventListener("mousemove", onPointerMove);
    document.addEventListener("mouseover", onPointerOver);
    if (!reduced) {
      glowEl.style.display = "block";
      glowRAF = requestAnimationFrame(glowLoop);
    }
    cursorOn = true;
  } else if (!enable && cursorOn) {
    if (dotEl) dotEl.style.display = "none";
    if (glowEl) glowEl.style.display = "none";
    document.body.classList.remove("custom-cursor");
    window.removeEventListener("mousemove", onPointerMove);
    document.removeEventListener("mouseover", onPointerOver);
    cancelAnimationFrame(glowRAF);
    cursorOn = false;
  }
}

// ---- Alerts ----
function syncAlertPrefs() {
  setAlertPrefs({
    desktop: settings.notifications,
    inApp: settings.inAppAlerts,
    sound: settings.alertSound,
  });
}

// Tell the user exactly where desktop notifications stand — the old UI gave no
// feedback at all, so a blocked permission looked like a broken feature.
function refreshNotifyStatus() {
  const box = document.getElementById("notify-status");
  if (!box) return;
  const perm = notificationPermission();
  if (!settings.notifications) {
    box.textContent = "In-app alerts still work with desktop notifications off.";
    box.className = "notify-status";
  } else if (perm === "granted") {
    box.textContent = "✅ Desktop notifications are allowed.";
    box.className = "notify-status ok";
  } else if (perm === "denied") {
    box.textContent = "⚠️ Blocked by your browser. Click the 🔒 icon next to the web address → Notifications → Allow.";
    box.className = "notify-status warn";
  } else if (perm === "unsupported") {
    box.textContent = "⚠️ This browser has no desktop notifications — in-app alerts will be used.";
    box.className = "notify-status warn";
  } else {
    box.textContent = "Permission not granted yet — toggle this on and accept the browser prompt.";
    box.className = "notify-status warn";
  }
}

function markSelected(container, selector, id) {
  container.querySelectorAll(selector).forEach((n) => {
    n.classList.toggle("selected", n.dataset.id === id);
  });
}

// Delete this account and everything belonging to it.
//
// There was previously no way to do this at all: someone who wanted to leave
// could delete individual chats and nothing more, while their profile,
// messages, keys and uploaded files stayed indefinitely with no route to
// remove them.
//
// Order matters. Storage objects are invisible to Postgres, so nothing
// cascades to them -- once the account is gone its uploads are unreachable
// even by an admin policy, because the owner no longer exists. So the files
// go first, while there is still a session allowed to remove them, and the
// account row goes last.
async function deleteAccount() {
  const confirmed = await confirmDelete({
    title: "Delete your account?",
    body:
      "This removes your profile, your messages, your encryption keys and every file you've uploaded. " +
      "Messages you sent to other people stay in their copy of the chat — we can only delete what's yours. " +
      "This cannot be undone.",
    danger: "Delete everything",
  });
  if (!confirmed) return;

  const userId = state.currentUser?.id;
  if (!userId) return;

  try {
    // Every file this account uploaded, found through the messages that
    // point at them -- there is no listing permission on the bucket, by
    // design, so the message rows are the index.
    const { data: mine } = await supabaseClient
      .from("messages")
      .select("file_url")
      .eq("user_id", userId)
      .not("file_url", "is", null);

    const urls = [...new Set((mine || []).map((m) => m.file_url).filter(Boolean))];
    if (state.myProfile?.avatar_url) urls.push(state.myProfile.avatar_url);
    // Best-effort: a file that refuses to delete must not strand someone in
    // an account they have asked to leave.
    await mapLimited(urls, 5, (url) => deleteAttachment(url).catch(() => false));

    const { error } = await supabaseClient.rpc("delete_my_account");
    if (error) throw error;

    // The account is gone; clear every local trace of it before the reload.
    await idbDelKey(userId);
    clearAttachmentCache();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* private mode -- nothing persisted anyway */
    }
    await supabaseClient.auth.signOut();
    location.reload();
  } catch (e) {
    console.error("Account deletion failed:", e);
    showToast("Couldn't delete your account. Nothing was removed — please try again.");
  }
}

export function initSettings() {
  // Apply saved prefs on load.
  applyAccent(settings.accent);
  applyAppFont(settings.appFont);
  applyWallpaper(settings.wallpaper);
  applyEffect(settings.effect, settings.ambientImage);
  applyCursor(settings.cursorGlow);
  applySkin(settings.ogSkin);
  syncAlertPrefs();

  document.getElementById("delete-account-btn")?.addEventListener("click", deleteAccount);

  // OG skin toggle.
  const ogBox = document.getElementById("setting-og-skin");
  if (ogBox) {
    ogBox.checked = settings.ogSkin;
    ogBox.addEventListener("change", () => {
      settings.ogSkin = ogBox.checked;
      applySkin(settings.ogSkin);
      save();
      // The per-chat accent sets --primary inline on <html>, which would
      // otherwise sit on top of the skin and leave the old accent stranded
      // against the new ground.
      applyAccent(settings.accent);
    });
  }

  // Accent swatches.
  const accentBox = document.getElementById("accent-swatches");
  THEME_PRESETS.forEach((p) => {
    const s = el("button", {
      class: "theme-swatch",
      type: "button",
      title: p.name,
      "aria-label": `${p.name} accent`,
      onClick: () => {
        settings.accent = p.id;
        save();
        applyAccent(p.id);
        markSelected(accentBox, ".theme-swatch", p.id);
      },
    });
    s.dataset.id = p.id;
    s.style.background = `linear-gradient(135deg, ${p.primary}, color-mix(in srgb, ${p.primary} 55%, white))`;
    accentBox.append(s);
  });
  markSelected(accentBox, ".theme-swatch", settings.accent);

  // App font chips — these restyle every bit of text in the app.
  const fontBox = document.getElementById("app-font-options");
  FONT_PRESETS.forEach((f) => {
    const chip = el("button", {
      class: "wallpaper-chip",
      type: "button",
      text: f.id === "default" ? "Default mix" : f.name,
      onClick: () => {
        settings.appFont = f.id;
        save();
        applyAppFont(f.id);
        markSelected(fontBox, ".wallpaper-chip", f.id);
      },
    });
    chip.dataset.id = f.id;
    if (f.id !== "default") chip.style.fontFamily = f.stack;
    fontBox.append(chip);
  });
  markSelected(fontBox, ".wallpaper-chip", settings.appFont);

  // Wallpaper chips ("custom" opens the file picker).
  const wpBox = document.getElementById("wallpaper-options");
  const wpInput = document.getElementById("wallpaper-input");
  WALLPAPER_PRESETS.forEach((w) => {
    const chip = el("button", {
      class: "wallpaper-chip",
      type: "button",
      text: w.name,
      onClick: () => {
        if (w.id === "custom") {
          wpInput.click();
          return;
        }
        settings.wallpaper = w.id;
        save();
        applyWallpaper(w.id);
        markSelected(wpBox, ".wallpaper-chip", w.id);
      },
    });
    chip.dataset.id = w.id;
    if (w.icon) chip.prepend(icon(w.icon, 14));
    wpBox.append(chip);
  });
  markSelected(wpBox, ".wallpaper-chip", settings.wallpaper);

  wpInput.addEventListener("change", async () => {
    const file = wpInput.files[0];
    wpInput.value = "";
    if (!file) return;
    try {
      settings.customWallpaper = await imageToWallpaperDataUrl(file);
      settings.wallpaper = "custom";
      save();
      applyWallpaper("custom");
      markSelected(wpBox, ".wallpaper-chip", "custom");
    } catch {
      showToast("Could not use that image.");
    }
  });

  // Ambient effect chips (Aurora / Liquid / Bubbles / Tech / Upload / None).
  const fxBox = document.getElementById("effect-options");
  const ambientInput = document.getElementById("ambient-input");
  EFFECT_PRESETS.forEach((f) => {
    const chip = el("button", {
      class: "wallpaper-chip",
      type: "button",
      text: f.name,
      onClick: () => {
        if (f.id === "image") {
          ambientInput.click();
          return;
        }
        settings.effect = f.id;
        save();
        applyEffect(f.id, settings.ambientImage);
        markSelected(fxBox, ".wallpaper-chip", f.id);
      },
    });
    chip.dataset.id = f.id;
    if (f.icon) chip.prepend(icon(f.icon, 14));
    fxBox.append(chip);
  });
  markSelected(fxBox, ".wallpaper-chip", settings.effect);

  ambientInput.addEventListener("change", async () => {
    const file = ambientInput.files[0];
    ambientInput.value = "";
    if (!file) return;
    try {
      settings.ambientImage = await imageToWallpaperDataUrl(file);
      settings.effect = "image";
      save();
      applyEffect("image", settings.ambientImage);
      markSelected(fxBox, ".wallpaper-chip", "image");
    } catch {
      showToast("Could not use that image.");
    }
  });

  // Alert toggles (desktop / in-app / sound) + the test button.
  const notifyToggle = document.getElementById("setting-notify");
  const inAppToggle = document.getElementById("setting-inapp");
  const soundToggle = document.getElementById("setting-sound");
  const cursorToggle = document.getElementById("setting-cursor");
  notifyToggle.checked = settings.notifications;
  inAppToggle.checked = settings.inAppAlerts;
  soundToggle.checked = settings.alertSound;
  cursorToggle.checked = settings.cursorGlow;
  refreshNotifyStatus();

  notifyToggle.addEventListener("change", async () => {
    settings.notifications = notifyToggle.checked;
    save();
    syncAlertPrefs();
    if (settings.notifications) {
      const result = await requestDesktopPermission();
      // A blocked browser can't be overridden from here — reflect reality.
      if (result !== "granted") {
        settings.notifications = false;
        notifyToggle.checked = false;
        save();
        syncAlertPrefs();
      }
    }
    refreshNotifyStatus();
  });
  inAppToggle.addEventListener("change", () => {
    settings.inAppAlerts = inAppToggle.checked;
    save();
    syncAlertPrefs();
  });
  soundToggle.addEventListener("change", () => {
    settings.alertSound = soundToggle.checked;
    save();
    syncAlertPrefs();
  });
  document.getElementById("test-alert-btn").addEventListener("click", () => {
    sendTestAlert();
    refreshNotifyStatus();
  });

  // ---- Change password ----
  const passwordModal = document.getElementById("password-modal");
  document.getElementById("change-password-btn").addEventListener("click", () => {
    ["current-password", "new-password", "confirm-password"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    passwordModal.classList.remove("hidden");
    document.getElementById("current-password").focus();
  });
  document.getElementById("close-password-modal").addEventListener("click", () => {
    passwordModal.classList.add("hidden");
  });

  const savePasswordBtn = document.getElementById("save-password-btn");
  savePasswordBtn.addEventListener("click", () =>
    withBusy(savePasswordBtn, "Changing…", async () => {
      const current = document.getElementById("current-password").value;
      const next = document.getElementById("new-password").value;
      const confirm = document.getElementById("confirm-password").value;

      if (!current || !next) return showToast("Fill in every field.");
      const weakNew = validatePassword(next);
      if (weakNew) return showToast(weakNew);
      if (next !== confirm) return showToast("The new passwords don't match.");
      if (next === current) return showToast("That's already your password.");

      // Refuse while messages are locked: without the private key in memory we
      // can't re-protect it, and changing the password would strand every
      // message behind a key nothing can open.
      if (!state.myPrivateKey) {
        return showToast("Unlock your messages first — otherwise changing your password would lock them permanently.");
      }

      // Confirm the current password really is theirs.
      const { error: authError } = await supabaseClient.auth.signInWithPassword({
        email: state.currentUser.email,
        password: current,
      });
      if (authError) return showToast("Your current password isn't right.");

      const { error: updateError } = await supabaseClient.auth.updateUser({ password: next });
      if (updateError) return showToast(updateError.message);

      // The password is changed; now the key must follow it.
      const rewrap = await rewrapPrivateKey(next);
      if (rewrap !== "ready") {
        showToast("Password changed, but your encryption key didn't update. Try Change password again now, while you're still signed in.");
        return;
      }

      passwordModal.classList.add("hidden");
      showToast("Password changed, and your encryption key moved with it.", "success");
    })
  );

  // ---- Privacy & lock ----
  const appLockToggle = document.getElementById("setting-app-lock");
  appLockToggle.checked = appLockEnabled();

  // Setting or changing one of the three PINs. Changing an existing one asks
  // for the old one first.
  async function managePin(purpose, label) {
    if (hasPin(purpose) && !(await askPin({ purpose, title: `Change ${label}`, subtitle: "Enter your current PIN first" }))) {
      return false;
    }
    const pin = window.prompt(`New 4–8 digit ${label}:`);
    if (!pin) return false;
    if (!(await setPin(purpose, pin))) return false;
    showToast(`${label[0].toUpperCase() + label.slice(1)} saved.`, "success");
    return true;
  }

  document.getElementById("pin-app-btn").addEventListener("click", () => managePin("app", "app PIN"));
  document.getElementById("pin-chat-btn").addEventListener("click", () => managePin("chat", "chat-lock PIN"));
  document.getElementById("pin-hidden-btn").addEventListener("click", () => managePin("hidden", "hidden-chats PIN"));

  appLockToggle.addEventListener("change", async () => {
    if (appLockToggle.checked) {
      if (!hasPin("app") && !(await managePin("app", "app PIN"))) {
        appLockToggle.checked = false;
        return;
      }
      setAppLock(true);
      showToast("App lock is on — Panalo will ask for your PIN when it opens.", "success");
    } else {
      // Turning protection off should itself be protected.
      if (hasPin("app") && !(await askPin({ purpose: "app", title: "Turn off app lock", subtitle: "Enter your app PIN" }))) {
        appLockToggle.checked = true;
        return;
      }
      setAppLock(false);
    }
  });

  // ---- About & shortcuts ----
  const aboutModal = document.getElementById("about-modal");
  const isMac = navigator.platform?.toLowerCase().includes("mac");
  document.getElementById("about-hidden-shortcut").textContent = SHORTCUT_LABEL;
  document.getElementById("about-paste-shortcut").textContent = isMac ? "⌘ + V" : "Ctrl + V";
  document.getElementById("about-btn").addEventListener("click", () => aboutModal.classList.remove("hidden"));
  document.getElementById("close-about-modal").addEventListener("click", () => aboutModal.classList.add("hidden"));
  document.getElementById("replay-tour-btn").addEventListener("click", () => {
    aboutModal.classList.add("hidden");
    document.getElementById("settings-modal").classList.add("hidden");
    startTour({ force: true });
  });
  cursorToggle.addEventListener("change", () => {
    settings.cursorGlow = cursorToggle.checked;
    save();
    applyCursor(settings.cursorGlow);
  });

  // Open / close.
  document.getElementById("settings-btn").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.remove("hidden");
  });
  document.getElementById("close-settings-modal").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.add("hidden");
  });
}
