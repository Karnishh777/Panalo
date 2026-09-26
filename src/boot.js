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

  // The logo: a glossy 3D chat bubble with three "typing" dots, on a tile in
  // the accent. In winter it gets a snowfall edition. Defined here, once, so
  // the tab icon is right from the first frame; src/appearance.js calls
  // PanaloFavicon again when the accent changes.
  function hex6(c) {
    return /^#[0-9a-f]{6}$/i.test(c) ? c : null;
  }
  // 1 Dec - 31 Jan.
  function season() {
    var m = new Date().getMonth();
    return m === 11 || m === 0 ? "snow" : "classic";
  }
  function panaloLogo(primary, strong, edition) {
    var B = "M30 52c0-15 11-26 26-26h28c15 0 26 11 26 26v12c0 15-11 26-26 26H66l-20 16c-3 2-7-1-6-4l3-12c-8-4-13-13-13-22z";
    var snow = edition === "snow";
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140">' +
      '<defs>' +
      '<linearGradient id="t" x1="0" y1="0" x2="1" y2="1">' +
        (snow ? '<stop offset="0" stop-color="#1d2a55"/><stop offset="1" stop-color="#070b16"/>'
              : '<stop offset="0" stop-color="' + primary + '"/><stop offset="1" stop-color="' + strong + '"/>') +
      '</linearGradient>' +
      '<radialGradient id="g" cx=".28" cy=".18" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#dfe5f5"/></linearGradient>' +
      '<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="d" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="' + mix(primary) + '"/><stop offset=".55" stop-color="' + primary + '"/><stop offset="1" stop-color="' + strong + '"/></radialGradient>' +
      '<clipPath id="c"><rect width="140" height="140" rx="36"/></clipPath>' +
      '<filter id="s" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>' +
      '</defs>' +
      '<rect width="140" height="140" rx="36" fill="url(#t)"/>' +
      '<rect width="140" height="140" rx="36" fill="url(#g)"/>' +
      (snow ? '<g clip-path="url(#c)">' + flakes() + '</g>' : '') +
      // soft contact shadow, then the extruded side, then the face
      '<path d="' + B + '" transform="translate(2 13)" fill="#000" opacity=".32" filter="url(#s)"/>' +
      '<g fill="' + (snow ? "#9fb0d6" : "#000") + '"' + (snow ? '' : ' opacity=".28"') + '>' +
        '<path d="' + B + '" transform="translate(0 7)"/></g>' +
      (snow ? '' : '<path d="' + B + '" transform="translate(0 7)" fill="#fff" opacity=".55"/>') +
      '<path d="' + B + '" fill="url(#f)"/>' +
      // glossy highlight across the top
      '<path d="M40 44c3-8 9-11 17-11h26c8 0 14 3 17 11c-12-4-48-4-60 0z" fill="url(#h)" opacity=".9"/>' +
      // three glossy dots: someone is typing
      dot(53, 60) + dot(70, 60) + dot(87, 60) +
      // sparkle
      '<path d="M113 17l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#fff" opacity=".95"/>' +
      '</svg>';
    return s;
    function dot(x, y) {
      return '<circle cx="' + x + '" cy="' + (y + 2) + '" r="7.5" fill="#000" opacity=".12"/>' +
        '<circle cx="' + x + '" cy="' + y + '" r="7.5" fill="url(#d)"/>' +
        '<circle cx="' + (x - 2) + '" cy="' + (y - 2.4) + '" r="2" fill="#fff" opacity=".85"/>';
    }
    function flakes() {
      var pts = [[18,22,2.2],[34,112,1.6],[122,98,2],[112,124,1.4],[16,78,1.4],[58,14,1.3],[88,120,1.8],[126,62,1.3],[22,128,1.2],[96,14,1.5]];
      return pts.map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + p[2] + '" fill="#fff" opacity=".8"/>'; }).join("") +
        '<path d="M0 118q35-10 70 0t70 0v22H0z" fill="#fff" opacity=".9"/>';
    }
    function mix(hex) { // lighten toward white for the dot's lit side
      var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
      var l = function (c) { return Math.round(c + (255 - c) * 0.45); };
      return "#" + ((1 << 24) + (l(r) << 16) + (l(g) << 8) + l(b)).toString(16).slice(1);
    }
  }
  window.PanaloLogo = panaloLogo;
  window.PanaloFavicon = function (primary, strong) {
    primary = hex6(primary) || "#d83b17";
    strong = hex6(strong) || primary;
    var svg = panaloLogo(primary, strong, season());
    var link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  };
  // <head> is still being parsed: the icon <link> comes later, so wait.
  document.addEventListener("DOMContentLoaded", function () {
    window.PanaloFavicon(vars && vars["--primary"], vars && vars["--primary-strong"]);
  });

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
