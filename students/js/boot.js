// Runs in <head>, before anything paints. Classic script, external file
// (the CSP forbids inline scripts).
//
//   1. If a Supabase session is stored, show a splash instead of flashing
//      the landing page at someone who is about to be signed straight in.
//   2. Apply the in-app "reduce motion" choice before any animation starts.
(function () {
  var root = document.documentElement;
  var signedIn = false;
  try {
    [localStorage, sessionStorage].forEach(function (store) {
      for (var i = 0; i < store.length; i++) {
        if (/^sb-.*-auth-token$/.test(store.key(i) || "")) signedIn = true;
      }
    });
  } catch (e) {}
  root.setAttribute("data-boot", signedIn ? "app" : "public");

  try {
    var prefs = JSON.parse(localStorage.getItem("panalo.students.prefs") || "{}") || {};
    if (prefs.reduceMotion) root.setAttribute("data-motion", "reduce");
  } catch (e) {}

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
