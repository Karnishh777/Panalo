// The public side: landing page, login / sign-up screens, and the hand-off
// into the app.
//
// Routing is by URL hash so the Back button works and a link to "#signup"
// lands on the right form, with no server routing needed (Cloudflare Pages
// serves one index.html). Nothing here touches authentication itself --
// auth.js still owns every Supabase call; this only decides what's on screen.
import { paintAccent, motionReduced } from "./appearance.js";
import { icon } from "./icons.js";
import { MIN_PASSWORD_LENGTH } from "./config.js";

const $ = (id) => document.getElementById(id);
const AUTH_ROUTES = new Set(["#login", "#signup"]);

let inApp = false;

function showLanding() {
  $("landing").classList.remove("hidden");
  $("auth-screen").classList.add("hidden");
}

function showAuth(view) {
  $("landing").classList.add("hidden");
  $("auth-screen").classList.remove("hidden");
  const signup = view === "signup";
  $("login-form").classList.toggle("hidden", signup);
  $("signup-form").classList.toggle("hidden", !signup);
  document.title = signup ? "Create your account · Panalo" : "Log in · Panalo";
  window.scrollTo(0, 0);
  // Don't yank focus to a field on phones: the keyboard would cover the form
  // before anyone has read it.
  if (window.matchMedia("(pointer: fine)").matches) {
    const first = signup
      ? ($("signup-step-2").classList.contains("hidden") ? $("signup-username") : $("otp-code-input"))
      : $("login-email");
    // Never steal focus from a field the person has already clicked into --
    // their typing would land in the wrong box (a password in the email field).
    setTimeout(() => {
      if (!$("auth-screen").contains(document.activeElement)) first?.focus();
    }, 50);
  }
}

function route() {
  if (inApp) return;
  const hash = location.hash;
  if (AUTH_ROUTES.has(hash)) {
    showAuth(hash.slice(1));
  } else {
    document.title = "Panalo — chat that's actually yours";
    showLanding();
  }
}

// Called by auth.js once it knows nobody is signed in.
export function showPublic() {
  document.documentElement.setAttribute("data-boot", "public");
  route();
}

// Called by auth.js when a session is ready.
export function enterApp() {
  inApp = true;
  document.documentElement.setAttribute("data-boot", "app");
  document.body.classList.add("in-app");
  $("landing").classList.add("hidden");
  $("auth-screen").classList.add("hidden");
  $("chat-app").classList.remove("hidden");
  document.title = "Panalo";
  // A #login left over from the sign-in form shouldn't linger in the URL.
  if (AUTH_ROUTES.has(location.hash)) history.replaceState(null, "", location.pathname + location.search);
}

// Called by auth.js on logout (and when a recovery link opens the auth UI).
export function leaveApp(view = "login") {
  inApp = false;
  document.body.classList.remove("in-app");
  document.documentElement.setAttribute("data-boot", "public");
  $("chat-app").classList.add("hidden");
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  showAuth(view);
}

// ---- Landing page ----
function initLanding() {
  const nav = $("land-nav");
  const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // The preview's swatches really re-theme it.
  const demo = $("hero-demo");
  demo?.querySelectorAll(".demo-swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      paintAccent(demo, sw.dataset.accent);
      demo.querySelectorAll(".demo-swatch").forEach((s) => s.setAttribute("aria-pressed", String(s === sw)));
    });
  });
  const modeBtn = $("demo-mode");
  modeBtn?.addEventListener("click", () => {
    const dark = demo.classList.toggle("demo-dark");
    modeBtn.replaceChildren(icon(dark ? "sun" : "moon", 16));
    modeBtn.setAttribute("aria-label", dark ? "Show light preview" : "Show dark preview");
  });

  // Sections ease in as they arrive. Skipped entirely when motion is
  // reduced, and without IntersectionObserver nothing is ever hidden.
  if (motionReduced() || !("IntersectionObserver" in window)) return;
  const targets = document.querySelectorAll(
    "#landing .section-head, #landing .bento-card, #landing .yours-grid li, #landing .privacy-card, #landing .land-final"
  );
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px" }
  );
  targets.forEach((t, i) => {
    t.classList.add("reveal");
    t.style.transitionDelay = `${(i % 3) * 70}ms`;
    io.observe(t);
  });
}

// ---- Auth niceties ----
function passwordStrength(pw) {
  if (!pw) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length < MIN_PASSWORD_LENGTH) return 1;
  if (pw.length >= 16 || (pw.length >= 12 && classes >= 3)) return 4;
  if (pw.length >= 12 || classes >= 3) return 3;
  return 2;
}

function initAuthUx() {
  // Show / hide password.
  document.querySelectorAll(".reveal-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = $(btn.dataset.reveal);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      btn.replaceChildren(icon(show ? "eyeOff" : "eye", 18));
      input.focus();
    });
  });
  // Re-hide on submit so a revealed password never sits on screen afterwards.
  // On the submit BUTTON's click, not the form's submit event: the button's
  // handler (withBusy) disables it at once, which cancels the submission, so
  // a submit event may never come.
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("button[type='submit']")) return;
    document.querySelectorAll(".reveal-btn[aria-pressed='true']").forEach((btn) => {
      const input = $(btn.dataset.reveal);
      if (input) input.type = "password";
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", "Show password");
      btn.replaceChildren(icon("eye", 18));
    });
  }, true);

  // Caps Lock warning: the most common reason a correct password "fails".
  const caps = [
    ["login-password", "login-caps"],
    ["signup-password", "signup-caps"],
  ];
  for (const [inputId, hintId] of caps) {
    const input = $(inputId);
    const hint = $(hintId);
    if (!input || !hint) continue;
    const check = (e) => {
      if (typeof e.getModifierState !== "function") return;
      hint.classList.toggle("hidden", !e.getModifierState("CapsLock"));
    };
    input.addEventListener("keydown", check);
    input.addEventListener("keyup", check);
    input.addEventListener("blur", () => hint.classList.add("hidden"));
  }

  // Strength hint (the rule itself is length -- see config.js -- so this
  // only encourages; it never blocks).
  const pw = $("signup-password");
  const meter = $("signup-strength");
  pw?.addEventListener("input", () => {
    meter.dataset.level = String(passwordStrength(pw.value));
  });

  // "@name" is how people write names; the @ isn't part of it.
  const uname = $("signup-username");
  uname?.addEventListener("input", () => {
    const cleaned = uname.value.replace(/^@+/, "");
    if (cleaned !== uname.value) uname.value = cleaned;
  });

  // Digits only in the code box, and submit on the sixth.
  const otp = $("otp-code-input");
  otp?.addEventListener("input", () => {
    otp.value = otp.value.replace(/\D/g, "").slice(0, 6);
    if (otp.value.length === 6) $("verify-otp-btn")?.click();
  });
}

export function initPublic() {
  initLanding();
  initAuthUx();
  window.addEventListener("hashchange", route);
  // A returning user's session is still being restored: auth.js decides.
  if (document.documentElement.getAttribute("data-boot") !== "app") route();
}
