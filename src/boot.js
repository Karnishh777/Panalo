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

  // The tab icon wears the accent too. Defined here, once, so it is right
  // from the first frame; src/appearance.js calls the same function when the
  // accent changes.
  function hex6(c) {
    return /^#[0-9a-f]{6}$/i.test(c) ? c : null;
  }
  window.PanaloFavicon = function (primary, strong) {
    primary = hex6(primary) || "#d83b17";
    strong = hex6(strong) || primary;
    // Flat and chunky: tile, a darker "depth" copy of the bubble, the bubble,
    // then the face -- eyes, and the checkmark as its smile.
    var bubble = "M30 52c0-15 11-26 26-26h28c15 0 26 11 26 26v12c0 15-11 26-26 26H66l-20 16c-3 2-7-1-6-4l3-12c-8-4-13-13-13-22z";
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140">' +
      '<rect width="140" height="140" rx="36" fill="' + primary + '"/>' +
      '<path d="' + bubble + '" transform="translate(0 8)" fill="' + strong + '"/>' +
      '<path d="' + bubble + '" fill="#fff"/>' +
      '<ellipse cx="57" cy="55" rx="7" ry="9" fill="#1b1822"/><ellipse cx="83" cy="55" rx="7" ry="9" fill="#1b1822"/>' +
      '<circle cx="59.5" cy="51.5" r="2.6" fill="#fff"/><circle cx="85.5" cy="51.5" r="2.6" fill="#fff"/>' +
      '<path d="M59 71l9 8 14-13" fill="none" stroke="' + primary + '" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>";
    var link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  };
  if (vars && vars["--primary"]) {
    // <head> is still being parsed: the icon <link> comes later, so wait.
    document.addEventListener("DOMContentLoaded", function () {
      window.PanaloFavicon(vars["--primary"], vars["--primary-strong"]);
    });
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
