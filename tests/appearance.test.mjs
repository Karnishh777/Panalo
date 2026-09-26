// Tests for src/appearance-core.js: what counts as a valid appearance
// setting, how old settings are carried forward, and what lands on <html>.
import {
  normalizeSettings, resolveTheme, accentVars, rootAttributes, themeColor, SETTINGS_DEFAULTS,
} from "../src/appearance-core.js";
import { THEME_PRESETS, LOOK_PRESETS, WALLPAPER_PRESETS } from "../src/config.js";
import fs from "node:fs";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

const accentIds = THEME_PRESETS.map((t) => t.id);
const wallpaperIds = ["doodle", "ambient", "dots", "plain", "custom"];

// ---- defaults ----
const d = normalizeSettings(null);
ok("empty storage gives the defaults", JSON.stringify(d) === JSON.stringify({ ...SETTINGS_DEFAULTS }));
ok("default theme follows the device", d.themeMode === "auto");

// ---- migrations ----
const og = normalizeSettings({ ogSkin: true, accent: "default" });
ok("OG skin becomes dark mode", og.themeMode === "dark");
ok("OG skin becomes the Grape accent", og.accent === "grape");
ok("ogSkin key is dropped", !("ogSkin" in og));
ok("OG skin keeps an accent that was chosen", normalizeSettings({ ogSkin: true, accent: "ocean" }).accent === "ocean");
ok("OG skin doesn't override an explicit theme", normalizeSettings({ ogSkin: true, themeMode: "light" }).themeMode === "light");
ok("ogSkin false changes nothing", normalizeSettings({ ogSkin: false }).themeMode === "auto");
const anim = normalizeSettings({ animatedBg: false });
ok("animatedBg:false becomes effect none", anim.effect === "none" && !("animatedBg" in anim));
ok("animatedBg:false doesn't override a chosen effect", normalizeSettings({ animatedBg: false, effect: "tech" }).effect === "tech");

// ---- validation ----
const bad = normalizeSettings(
  { themeMode: "neon", bubbles: "blob", textSize: "xxl", density: "tiny", accent: "nope", wallpaper: "lava" },
  { accentIds, wallpaperIds }
);
ok("unknown theme mode → auto", bad.themeMode === "auto");
ok("unknown bubble shape → round", bad.bubbles === "round");
ok("unknown text size → m", bad.textSize === "m");
ok("unknown density → comfortable", bad.density === "comfortable");
ok("unknown accent → default", bad.accent === "default");
ok("unknown wallpaper → doodle", bad.wallpaper === "doodle");
ok("custom wallpaper without an image falls back", normalizeSettings({ wallpaper: "custom" }, { wallpaperIds }).wallpaper === "doodle");
ok("custom wallpaper with an image is kept", normalizeSettings({ wallpaper: "custom", customWallpaper: "data:x" }, { wallpaperIds }).wallpaper === "custom");
ok("flags are booleans", normalizeSettings({ quickReplies: 1, reduceMotion: "yes" }).quickReplies === true);
ok("quick replies are on by default", normalizeSettings(null).quickReplies === true);
ok("old quickBar:false no longer hides the emoji bar", normalizeSettings({ quickBar: false }).quickReplies === true && !("quickBar" in normalizeSettings({ quickBar: false })));
ok("non-appearance keys pass through", normalizeSettings({ alertSound: false }).alertSound === false);
ok("new accents are accepted", normalizeSettings({ accent: "sky" }, { accentIds }).accent === "sky");

// ---- theme resolution ----
ok("auto + dark device → dark", resolveTheme("auto", true) === "dark");
ok("auto + light device → light", resolveTheme("auto", false) === "light");
ok("explicit light wins over a dark device", resolveTheme("light", true) === "light");
ok("explicit dark wins over a light device", resolveTheme("dark", false) === "dark");
ok("theme colours differ", themeColor("dark") !== themeColor("light"));

// ---- attributes ----
const attrs = rootAttributes(normalizeSettings({ themeMode: "dark", density: "compact", bubbles: "crisp", textSize: "l", reduceMotion: true }), false);
ok("data-theme", attrs["data-theme"] === "dark");
ok("data-density", attrs["data-density"] === "compact");
ok("data-bubbles", attrs["data-bubbles"] === "crisp");
ok("data-text", attrs["data-text"] === "l");
ok("data-motion", attrs["data-motion"] === "reduce");
const plain = rootAttributes(normalizeSettings({}), true);
ok("defaults remove optional attributes",
  plain["data-density"] === null && plain["data-bubbles"] === null && plain["data-text"] === null && plain["data-motion"] === null);
ok("defaults on a dark device are dark", plain["data-theme"] === "dark");

// ---- accents ----
const v = accentVars(THEME_PRESETS[0]);
ok("accent sets exactly three variables", Object.keys(v).length === 3);
ok("accent defaults on-primary to white", v["--on-primary"] === "#ffffff");
ok("no preset, no variables", accentVars(undefined) === null);
ok("accent ids are unique", new Set(accentIds).size === accentIds.length);
// conversations.theme stores these ids -- removing one would strand chats.
for (const id of ["default", "sunset", "ocean", "forest", "rose", "slate"]) {
  ok(`legacy chat theme id "${id}" still exists`, accentIds.includes(id));
}
// White text on every accent must meet WCAG AA (4.5:1).
const lum = (hex) => {
  const [r, g, b] = hex.match(/[\da-f]{2}/gi).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
for (const p of THEME_PRESETS) {
  const ratio = 1.05 / (lum(p.primary) + 0.05);
  ok(`${p.name}: white text contrast ${ratio.toFixed(2)} >= 4.5`, ratio >= 4.5);
}

// ---- Looks and wallpapers ----
for (const look of LOOK_PRESETS) {
  ok(`look "${look.id}" uses a real accent`, accentIds.includes(look.accent));
  ok(`look "${look.id}" uses a real theme`, look.mode === "light" || look.mode === "dark");
}
ok("look ids are unique", new Set(LOOK_PRESETS.map((l) => l.id)).size === LOOK_PRESETS.length);
for (const w of WALLPAPER_PRESETS.filter((w) => w.scene)) {
  ok(`wallpaper "${w.id}" file exists`, fs.existsSync(new URL(`../${w.scene}`, import.meta.url)));
}
ok("wallpaper ids are unique", new Set(WALLPAPER_PRESETS.map((w) => w.id)).size === WALLPAPER_PRESETS.length);
ok("new wallpapers are accepted by the settings rules",
  normalizeSettings({ wallpaper: "galaxy" }, { wallpaperIds: WALLPAPER_PRESETS.map((w) => w.id) }).wallpaper === "galaxy");

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log("  FAIL:", f));
  process.exit(1);
}
