// Settings: appearance, notifications, privacy & lock, account.
//
// Everything visual is per-device and stored in localStorage (no backend
// needed). The rules for what a valid setting is live in appearance-core.js
// and are unit-tested; this file wires them to the controls.
import { THEME_PRESETS, WALLPAPER_PRESETS, EFFECT_PRESETS, FONT_PRESETS, LOOK_PRESETS } from "./config.js";
import { validatePassword } from "./password.js";
import { el, showToast, withBusy, mapLimited } from "./util.js";
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
import { normalizeSettings, accentVars } from "./appearance-core.js";
import { applyRootAppearance, watchSystemTheme, paintAccent, accentPreset, paintFavicon } from "./appearance.js";
import { ensureFont, ensureAllFonts } from "./fonts.js";
import { promptSecret, pinProblem } from "./dialogs.js";

const SETTINGS_KEY = "panalo.settings";

function load() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    stored = {};
  }
  return normalizeSettings(stored, {
    accentIds: THEME_PRESETS.map((t) => t.id),
    wallpaperIds: WALLPAPER_PRESETS.map((w) => w.id),
  });
}

function save() {
  try {
    // accentVars rides along so src/boot.js can paint the accent before any
    // module has loaded.
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, accentVars: accentVars(accentPreset(settings.accent)) }));
  } catch {
    // Likely quota (a big custom wallpaper) — the setting still applies this session.
    showToast("Couldn't save that image (too large). It'll reset on reload.", "");
  }
  document.dispatchEvent(new CustomEvent("panalo:settings", { detail: settings }));
}

const settings = load();

export function getSetting(key) {
  return settings[key];
}

// ---- Appearance ----
function applyAppearance() {
  applyRootAppearance(settings);
  paintAccent(document.documentElement, settings.accent);
  paintFavicon(settings.accent);
}

function applyAppFont(id) {
  const root = document.documentElement.style;
  const preset = FONT_PRESETS.find((f) => f.id === id);
  if (!preset || id === "default") {
    root.removeProperty("--font-ui");
    root.removeProperty("--chat-font");
    return;
  }
  ensureFont(preset);
  root.setProperty("--font-ui", preset.stack);
  root.setProperty("--chat-font", preset.stack);
}

function applyWallpaper(id) {
  const container = document.querySelector(".app-container");
  if (!container) return;
  container.dataset.wallpaper = id;
  if (id === "custom" && settings.customWallpaper) {
    container.style.setProperty("--custom-wp", `url("${settings.customWallpaper}")`);
  } else {
    container.style.removeProperty("--custom-wp");
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

// ---- Custom cursor (themed dot + soft glow trail; desktop only) ----
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
  const interactive = e.target.closest('button, a, [role="button"], .conv-item, input, textarea, label, summary');
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
  const reduced = settings.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

// Tell the user exactly where desktop notifications stand — a blocked
// permission otherwise looks like a broken feature.
function refreshNotifyStatus() {
  const box = document.getElementById("notify-status");
  if (!box) return;
  const perm = notificationPermission();
  if (!settings.notifications) {
    box.textContent = "In-app alerts still work with desktop notifications off.";
    box.className = "notify-status";
  } else if (perm === "granted") {
    box.textContent = "Desktop notifications are allowed.";
    box.className = "notify-status ok";
  } else if (perm === "denied") {
    box.textContent = "Blocked by your browser. Open the site settings (the icon left of the address) → Notifications → Allow.";
    box.className = "notify-status warn";
  } else if (perm === "unsupported") {
    box.textContent = "This browser has no desktop notifications — in-app alerts will be used.";
    box.className = "notify-status warn";
  } else {
    box.textContent = "Permission not granted yet — switch this on and accept the browser prompt.";
    box.className = "notify-status warn";
  }
}

function markSelected(container, selector, id) {
  container.querySelectorAll(selector).forEach((n) => {
    const on = n.dataset.id === id;
    n.classList.toggle("selected", on);
    if (n.getAttribute("role") === "radio") {
      n.setAttribute("aria-checked", String(on));
      n.tabIndex = on ? 0 : -1;
    }
  });
}

// A row of mutually exclusive choices, announced and navigated as a radio
// group (arrow keys move and select, like a native one).
function radioGroup(box, options, current, onPick, { cls = "", render } = {}) {
  box.innerHTML = "";
  options.forEach((opt) => {
    const b = el("button", { type: "button", role: "radio", class: cls, "aria-checked": String(opt.id === current), "aria-label": opt.label });
    b.dataset.id = opt.id;
    b.tabIndex = opt.id === current ? 0 : -1;
    if (render) render(b, opt);
    else b.textContent = opt.label;
    b.addEventListener("click", () => {
      onPick(opt.id);
      markSelected(box, "[role='radio']", opt.id);
    });
    box.append(b);
  });
  box.addEventListener("keydown", (e) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    const items = [...box.querySelectorAll("[role='radio']")];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = items[(i + step + items.length) % items.length];
    next.focus();
    next.click();
  });
}

// Delete this account and everything belonging to it.
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

// ---- Tabs ----
const TABS = ["appearance", "notifications", "privacy", "account"];
function selectTab(name, { focus = false } = {}) {
  TABS.forEach((t) => {
    const tab = document.getElementById(`tab-${t}`);
    const panel = document.getElementById(`panel-${t}`);
    const on = t === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    panel.classList.toggle("hidden", !on);
    if (on && focus) tab.focus();
  });
  document.querySelector("#settings-modal .settings-body")?.scrollTo({ top: 0 });
}

export function openSettings(tab = "appearance") {
  selectTab(tab);
  refreshNotifyStatus();
  const enc = document.getElementById("encryption-status");
  if (enc) {
    enc.textContent = state.myPrivateKey
      ? "Encryption is set up on this device. Message text and files are encrypted before they're sent."
      : "Your messages are locked on this device, so new messages can't be encrypted until you unlock them.";
  }
  document.getElementById("setting-app-lock").checked = appLockEnabled();
  document.getElementById("settings-modal").classList.remove("hidden");
}

// Set or change one of the three PINs. Changing an existing one asks for the
// old one first.
async function managePin(purpose, label) {
  if (hasPin(purpose) && !(await askPin({ purpose, title: `Change ${label}`, subtitle: "Enter your current PIN first" }))) {
    return false;
  }
  const pin = await promptSecret({
    title: hasPin(purpose) ? `New ${label}` : `Set a ${label}`,
    subtitle: "4 to 8 digits. It stays on this device and is never sent anywhere.",
    placeholder: "New PIN",
    confirmPlaceholder: "Repeat PIN",
    numeric: true,
    submitLabel: "Save PIN",
    validate: pinProblem,
  });
  if (!pin) return false;
  if (!(await setPin(purpose, pin))) return false;
  showToast(`${label[0].toUpperCase() + label.slice(1)} saved.`, "success");
  return true;
}
export { managePin };

export function initSettings() {
  // Apply saved prefs on load.
  applyAppearance();
  watchSystemTheme(() => settings);
  applyAppFont(settings.appFont);
  applyWallpaper(settings.wallpaper);
  applyEffect(settings.effect, settings.ambientImage);
  applyCursor(settings.cursorGlow);
  syncAlertPrefs();

  document.getElementById("delete-account-btn")?.addEventListener("click", deleteAccount);

  // ---- Tabs ----
  TABS.forEach((t, i) => {
    const tab = document.getElementById(`tab-${t}`);
    tab.addEventListener("click", () => selectTab(t));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const next = TABS[(i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
      selectTab(next, { focus: true });
    });
  });

  // ---- Looks: one tap sets theme + accent ----
  const lookBox = document.getElementById("look-options");
  const syncLooks = () => {
    lookBox.querySelectorAll(".look-card").forEach((c) => {
      const look = LOOK_PRESETS.find((l) => l.id === c.dataset.id);
      const on = settings.themeMode === look.mode && settings.accent === look.accent;
      c.setAttribute("aria-pressed", String(on));
    });
  };
  LOOK_PRESETS.forEach((look) => {
    const accent = accentPreset(look.accent).primary;
    const dark = look.mode === "dark";
    const swatch = el("span", { class: "look-swatch", "aria-hidden": "true" }, [el("i"), el("i")]);
    swatch.style.setProperty("--lk-bg", dark ? "#0e1424" : "#f7f4f0");
    swatch.style.setProperty("--lk-in", dark ? "#243050" : "#ffffff");
    swatch.style.setProperty("--lk-accent", accent);
    const card = el("button", {
      class: "look-card",
      type: "button",
      "aria-label": `${look.name} look`,
      onClick: () => {
        settings.themeMode = look.mode;
        settings.accent = look.accent;
        save();
        applyAppearance();
        // Keep the individual controls below in step.
        markSelected(document.getElementById("theme-mode-options"), "[role='radio']", look.mode);
        const acc = document.getElementById("accent-swatches");
        markSelected(acc, "[role='radio']", look.accent);
        acc.querySelectorAll(".theme-swatch").forEach((sw) => sw.classList.toggle("selected", sw.dataset.id === look.accent));
        syncLooks();
      },
    }, [swatch, el("span", { text: look.name })]);
    card.dataset.id = look.id;
    lookBox.append(card);
  });
  syncLooks();
  document.addEventListener("panalo:settings", syncLooks);

  // ---- Theme mode ----
  radioGroup(
    document.getElementById("theme-mode-options"),
    [
      { id: "auto", label: "Auto", ico: "monitor" },
      { id: "light", label: "Light", ico: "sun" },
      { id: "dark", label: "Dark", ico: "moon" },
    ],
    settings.themeMode,
    (id) => {
      settings.themeMode = id;
      save();
      applyAppearance();
    },
    { render: (b, o) => b.append(icon(o.ico, 15), o.label) }
  );

  // ---- Accent ----
  const accentBox = document.getElementById("accent-swatches");
  radioGroup(
    accentBox,
    THEME_PRESETS.map((p) => ({ id: p.id, label: `${p.name} accent`, color: p.primary })),
    settings.accent,
    (id) => {
      settings.accent = id;
      save();
      applyAppearance();
    },
    {
      cls: "theme-swatch",
      render: (b, o) => {
        b.style.background = o.color;
        b.title = o.label.replace(" accent", "");
        if (o.id === settings.accent) b.classList.add("selected");
      },
    }
  );
  // Keep the .selected ring in step with aria-checked.
  accentBox.addEventListener("click", () => {
    accentBox.querySelectorAll(".theme-swatch").forEach((s) => s.classList.toggle("selected", s.getAttribute("aria-checked") === "true"));
  });

  // ---- Bubbles + text size ----
  radioGroup(
    document.getElementById("bubble-options"),
    [
      { id: "round", label: "Bubbly" },
      { id: "soft", label: "Soft" },
      { id: "crisp", label: "Crisp" },
    ],
    settings.bubbles,
    (id) => {
      settings.bubbles = id;
      save();
      applyAppearance();
    }
  );
  radioGroup(
    document.getElementById("text-size-options"),
    [
      { id: "s", label: "Small" },
      { id: "m", label: "Default" },
      { id: "l", label: "Large" },
    ],
    settings.textSize,
    (id) => {
      settings.textSize = id;
      save();
      applyAppearance();
    }
  );

  // ---- Toggles ----
  const bindToggle = (id, key, after) => {
    const box = document.getElementById(id);
    if (!box) return;
    box.checked = !!settings[key];
    box.addEventListener("change", () => {
      settings[key] = box.checked;
      save();
      after?.(box.checked);
    });
  };
  const compact = document.getElementById("setting-compact");
  compact.checked = settings.density === "compact";
  compact.addEventListener("change", () => {
    settings.density = compact.checked ? "compact" : "comfortable";
    save();
    applyAppearance();
  });
  bindToggle("setting-quickbar", "quickBar");
  bindToggle("setting-reduce-motion", "reduceMotion", () => {
    applyAppearance();
    applyEffect(settings.effect, settings.ambientImage);
  });
  bindToggle("setting-cursor", "cursorGlow", (on) => applyCursor(on));

  // ---- App font ----
  const fontBox = document.getElementById("app-font-options");
  FONT_PRESETS.forEach((f) => {
    const chip = el("button", {
      class: "wallpaper-chip",
      type: "button",
      text: f.id === "default" ? "Default" : f.name,
      "aria-pressed": String(f.id === settings.appFont),
      onClick: () => {
        settings.appFont = f.id;
        save();
        applyAppFont(f.id);
        markSelected(fontBox, ".wallpaper-chip", f.id);
        fontBox.querySelectorAll(".wallpaper-chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.id === f.id)));
      },
    });
    chip.dataset.id = f.id;
    if (f.id !== "default") chip.style.fontFamily = f.stack;
    fontBox.append(chip);
  });
  markSelected(fontBox, ".wallpaper-chip", settings.appFont);
  // Preview every font in its own face, but only once someone looks.
  document.querySelector("#settings-modal .settings-more")?.addEventListener("toggle", (e) => {
    if (e.target.open) ensureAllFonts();
  });

  // ---- Wallpaper gallery ("Upload" opens the file picker) ----
  const wpBox = document.getElementById("wallpaper-options");
  const wpInput = document.getElementById("wallpaper-input");
  const wpThumb = (w) => {
    const thumb = el("span", { class: "wp-thumb", "aria-hidden": "true" });
    if (w.scene) thumb.style.backgroundImage = `url("${w.scene}")`;
    else if (w.id === "doodle" || w.id === "dots") thumb.classList.add(`pat-${w.id}`);
    else if (w.id === "custom" && settings.customWallpaper) thumb.style.backgroundImage = `url("${settings.customWallpaper}")`;
    else if (w.icon) thumb.append(icon(w.icon, 22));
    return thumb;
  };
  WALLPAPER_PRESETS.forEach((w) => {
    const tile = el("button", {
      class: "wp-tile",
      type: "button",
      "aria-label": `${w.name} wallpaper`,
      onClick: () => {
        if (w.id === "custom") {
          wpInput.click();
          return;
        }
        settings.wallpaper = w.id;
        save();
        applyWallpaper(w.id);
        markSelected(wpBox, ".wp-tile", w.id);
      },
    }, [wpThumb(w), el("span", { text: w.name })]);
    tile.dataset.id = w.id;
    wpBox.append(tile);
  });
  markSelected(wpBox, ".wp-tile", settings.wallpaper);

  wpInput.addEventListener("change", async () => {
    const file = wpInput.files[0];
    wpInput.value = "";
    if (!file) return;
    try {
      settings.customWallpaper = await imageToWallpaperDataUrl(file);
      settings.wallpaper = "custom";
      save();
      applyWallpaper("custom");
      markSelected(wpBox, ".wp-tile", "custom");
      const thumb = wpBox.querySelector('[data-id="custom"] .wp-thumb');
      if (thumb) {
        thumb.replaceChildren();
        thumb.style.backgroundImage = `url("${settings.customWallpaper}")`;
      }
    } catch {
      showToast("Could not use that image.");
    }
  });

  // ---- Ambient background ----
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

  // ---- Alerts ----
  const notifyToggle = document.getElementById("setting-notify");
  const inAppToggle = document.getElementById("setting-inapp");
  const soundToggle = document.getElementById("setting-sound");
  notifyToggle.checked = settings.notifications;
  inAppToggle.checked = settings.inAppAlerts;
  soundToggle.checked = settings.alertSound;
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
  const replayTour = () => {
    aboutModal.classList.add("hidden");
    document.getElementById("settings-modal").classList.add("hidden");
    startTour({ force: true });
  };
  document.getElementById("replay-tour-btn").addEventListener("click", replayTour);
  document.getElementById("replay-tour-shortcut")?.addEventListener("click", replayTour);

  // ---- Account ----
  document.getElementById("settings-profile-btn")?.addEventListener("click", () => {
    document.getElementById("settings-modal").classList.add("hidden");
    document.getElementById("rail-profile")?.click();
  });

  // ---- Open / close ----
  document.getElementById("settings-btn").addEventListener("click", () => openSettings());
  const close = () => document.getElementById("settings-modal").classList.add("hidden");
  document.getElementById("close-settings-modal").addEventListener("click", close);
  document.getElementById("close-settings-x")?.addEventListener("click", close);
  document.getElementById("settings-modal").addEventListener("click", (e) => {
    if (e.target.id === "settings-modal") close();
  });
}
