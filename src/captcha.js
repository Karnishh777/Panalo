// Bot protection for the auth endpoints, with Cloudflare Turnstile (free).
//
// Off until the site is given a Turnstile site key: functions/api/captcha.js
// hands out TURNSTILE_SITE_KEY from the Pages project's variables. Supabase
// checks the token with the matching secret (Authentication → Attack
// Protection). Turn on the Supabase side only AFTER the site key is live,
// or sign-in stops working (see HOSTING.md).
//
// Every call that Supabase protects (sign-up, password sign-in, password
// reset, resending a code) asks `captcha()` for a fresh, single-use token.
// The widget is "interaction-only": most people never see it; a suspicious
// visitor gets a small check in the middle of the screen.

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let keyPromise = null;
let apiPromise = null;

function siteKey() {
  keyPromise ??= fetch("/api/captcha", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => (typeof j?.siteKey === "string" && j.siteKey ? j.siteKey : null))
    .catch(() => null);
  return keyPromise;
}

function loadApi() {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile")));
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("The bot check couldn't load. Check your connection and try again."));
    };
    document.head.append(s);
  });
  return apiPromise;
}

/** Whether this site has bot protection switched on. */
export async function captchaEnabled() {
  return Boolean(await siteKey());
}

/**
 * Options to spread into a protected auth call: `{ captchaToken }` when bot
 * protection is on, `{}` when it isn't. Rejects with a readable message if
 * the check can't be completed.
 */
export async function captcha() {
  const key = await siteKey();
  if (!key) return {};
  const ts = await loadApi();
  return new Promise((resolve, reject) => {
    const box = document.createElement("div");
    box.className = "captcha-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Quick check that you're human");
    document.body.append(box);
    let id = null;
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setTimeout(() => {
        try {
          if (id !== null) ts.remove(id);
        } catch {}
        box.remove();
      }, 0);
      fn(value);
    };
    const timer = setTimeout(() => done(reject, new Error("The bot check timed out. Try again.")), 90_000);
    try {
      id = ts.render(box, {
        sitekey: key,
        appearance: "interaction-only",
        theme: "dark",
        callback: (token) => done(resolve, { captchaToken: token }),
        "error-callback": () => done(reject, new Error("The bot check failed. Reload the page and try again.")),
        "expired-callback": () => done(reject, new Error("The bot check expired. Try again.")),
      });
    } catch (e) {
      done(reject, new Error("The bot check couldn't start. Reload the page and try again."));
    }
  });
}
