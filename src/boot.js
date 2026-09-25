// Runs in <head>, before the stylesheets paint anything.
//
// Two jobs, both about avoiding a flash of the wrong thing:
//   1. Apply the saved theme, accent and appearance attributes, so a dark-mode
//      user never sees a white frame and an accent never snaps from Ember to
//      Grape after load.
//   2. Note whether a session is stored, so a returning user sees a brief
//      splash instead of the public landing page flashing past.
//
// Classic script (not a module) because it must run synchronously, and an
// external file because the Content-Security-Policy forbids inline scripts.
// The rules live in src/appearance-core.js; the values used here are the
// ones src/appearance.js resolved and saved, so the two cannot disagree.
(function () {
  var root = document.documentElement;
  var s = {};
  try {
    s = JSON.parse(localStorage.getItem("panalo.settings") || "{}") || {};
  } catch (e) {
    s = {};
  }

  var mode = s.themeMode || (s.ogSkin ? "dark" : "auto");
  var prefersDark = false;
  try {
    prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (e) {}
  root.setAttribute("data-theme", mode === "light" || mode === "dark" ? mode : prefersDark ? "dark" : "light");
  if (s.density === "compact") root.setAttribute("data-density", "compact");
  if (s.bubbles === "soft" || s.bubbles === "crisp") root.setAttribute("data-bubbles", s.bubbles);
  if (s.textSize === "s" || s.textSize === "l") root.setAttribute("data-text", s.textSize);
  if (s.reduceMotion) root.setAttribute("data-motion", "reduce");

  var vars = s.accentVars;
  if (vars && typeof vars === "object") {
    for (var k in vars) {
      if (/^--[a-z-]+$/.test(k) && /^#[0-9a-f]{3,8}$/i.test(String(vars[k]))) root.style.setProperty(k, vars[k]);
    }
  }

  // Supabase keeps its session under "sb-<project>-auth-token", in
  // localStorage or (with "Keep me logged in" off) sessionStorage.
  var signedIn = false;
  try {
    [localStorage, sessionStorage].forEach(function (store) {
      for (var i = 0; i < store.length; i++) {
        if (/^sb-.*-auth-token$/.test(store.key(i) || "")) signedIn = true;
      }
    });
  } catch (e) {}
  root.setAttribute("data-boot", signedIn ? "app" : "public");

  // If the app never finishes starting (offline with nothing cached, a CDN
  // outage), don't leave a splash up forever: show the public page instead.
  if (signedIn) {
    setTimeout(function () {
      var body = document.body;
      if (!body || body.classList.contains("in-app")) return;
      if (document.querySelector(".modal:not(.hidden)")) return; // e.g. the unlock prompt
      root.setAttribute("data-boot", "public");
    }, 12000);
  }
})();
