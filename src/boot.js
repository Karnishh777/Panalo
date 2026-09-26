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
  function mix(a, b, t) {
    var out = "#";
    for (var i = 1; i < 7; i += 2) {
      var v = Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t);
      out += ("0" + v.toString(16)).slice(-2);
    }
    return out;
  }
  window.PanaloFavicon = function (primary, strong) {
    primary = hex6(primary) || "#d83b17";
    strong = hex6(strong) || primary;
    var light = mix(primary, "#ffb45e", 0.35);
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + light + '"/><stop offset="1" stop-color="' + strong + '"/>' +
      "</linearGradient></defs>" +
      '<rect width="140" height="140" rx="38" fill="url(#g)"/>' +
      '<path d="M36 58c0-13 9-22 22-22h24c13 0 22 9 22 22v14c0 13-9 22-22 22H64l-19 15 4-15c-8-3-13-11-13-22z" fill="#fff"/>' +
      '<path d="M55 66l10 10 21-22" fill="none" stroke="' + primary + '" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>' +
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
