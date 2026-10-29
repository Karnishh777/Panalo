// Runs in <head>, before anything paints. Classic script, external file
// (the CSP forbids inline scripts).
//
//   1. If a Supabase session is stored, show a splash instead of flashing
//      the landing page at someone who is about to be signed straight in.
//   2. Stop forms submitting natively before the app's modules arrive.
//   3. Apply the in-app "reduce motion" choice before any animation starts.
//   4. Apply the chosen look (and load its fonts).
(function () {
  var root = document.documentElement;
  // 0. crypto.randomUUID is Safari 15.4+: older browsers get the same
  //    random (version 4) id from getRandomValues.
  if (window.crypto && !crypto.randomUUID && crypto.getRandomValues) {
    crypto.randomUUID = function () {
      var b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      var h = [];
      for (var i = 0; i < 16; i++) h.push((b[i] + 256).toString(16).slice(1));
      return h.slice(0, 4).join("") + "-" + h.slice(4, 6).join("") + "-" + h.slice(6, 8).join("") + "-" + h.slice(8, 10).join("") + "-" + h.slice(10).join("");
    };
  }
  var signedIn = false;
  try {
    [localStorage, sessionStorage].forEach(function (store) {
      for (var i = 0; i < store.length; i++) {
        if (/^sb-.*-auth-token$/.test(store.key(i) || "")) signedIn = true;
      }
    });
  } catch (e) {}
  root.setAttribute("data-boot", signedIn ? "app" : "public");

  // Every form here is handled by the app's modules. Until they have loaded
  // (a slow connection), pressing Enter must not fall through to a native
  // submission, which would reload the page and lose what was typed.
  document.addEventListener("submit", function (e) {
    e.preventDefault();
  }, true);

  // 4. The look (js/looks.js): Night, and its fonts, before
  //    the first paint so the page never flashes the wrong one.
  var NIGHT = "family=Inter+Tight:wght@600..900&family=Plus+Jakarta+Sans:wght@400..700&family=Instrument+Serif:ital@0;1";
  var FONTS = { night: NIGHT };
  var look = "night";
  root.setAttribute("data-effects", "calm");
  try {
    var prefs = JSON.parse(localStorage.getItem("panalo.students.prefs") || "{}") || {};
    if (prefs.reduceMotion) root.setAttribute("data-motion", "reduce");
    if (prefs.textSize && prefs.textSize !== "normal") root.setAttribute("data-text", prefs.textSize);
    if (FONTS[prefs.look]) look = prefs.look;
    if (prefs.effects === "lively") root.setAttribute("data-effects", "lively");
  } catch (e) {}
  root.setAttribute("data-look", look);
  var fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href = "https://fonts.googleapis.com/css2?" + FONTS[look] + "&display=swap";
  fonts.setAttribute("data-look-fonts", look);
  document.head.appendChild(fonts);

  // Never leave the splash up forever (offline with nothing cached, a CDN
  // outage): after a while, fall back to the landing page.
  if (signedIn) {
    setTimeout(function () {
      if (document.body && !document.body.classList.contains("ready")) {
        root.setAttribute("data-boot", "public");
        document.body.classList.add("ready");
      }
    }, 12000);
  }
})();
