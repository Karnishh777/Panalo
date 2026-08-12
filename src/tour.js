// The welcome tour. Shown once, after a brand-new account is created, then
// never again unless someone asks for it from About.
//
// It's meant to be quick and a bit silly — nobody reads a manual — but every
// card teaches one real thing, including the two that are genuinely hard to
// discover: the hidden-chats gesture and where chat lock lives.
import { el } from "./util.js";
import { icon } from "./icons.js";
import { SHORTCUT_LABEL } from "./lock.js";

const SEEN_KEY = "panalo.tourSeen";

export function tourSeen() {
  return localStorage.getItem(SEEN_KEY) === "1";
}
function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

const slides = () => [
  {
    icon: "sparkle",
    title: "You're in ✨",
    body: "Welcome to Panalo. Everything you type gets scrambled on your device before it leaves — the server just stores expensive-looking gibberish. Nice for it.",
  },
  {
    icon: "plus",
    title: "Start something",
    body: "The + at the top-left is where chats begin. One person or a whole group, your call. Group names are permanent, so choose wisely (or don't — you can rename it later).",
  },
  {
    icon: "palette",
    title: "Make it yours",
    body: "Accents, wallpapers, fonts, and ambient effects live in ⚙️ Settings. Try the Tech effect. We spent a suspicious amount of time on the Tech effect.",
  },
  {
    icon: "smile",
    title: "Say it without words",
    body: "Stickers, reactions, replies, and files up to 50 MB. You can paste a screenshot straight into a chat — no saving it first like it's 2009.",
  },
  {
    icon: "phone",
    title: "Call people",
    body: "Voice and video, right from a chat's header. Works on most Wi-Fi. Some mobile networks are grumpy about it — that's them, not you.",
  },
  {
    icon: "lock",
    title: "The secret bit 🤫",
    body: `Lock or hide any chat from its ⋮ menu. Hidden chats vanish completely — bring them back with ${SHORTCUT_LABEL}, or a two-finger tap on a phone. There's no button for it anywhere, which is rather the point.`,
  },
  {
    icon: "check",
    title: "That's everything",
    body: "The rest you'll find by poking around. All of this is in Settings → About & shortcuts whenever you want it again. Go on — message someone.",
  },
];

export function startTour({ force = false } = {}) {
  if (!force && tourSeen()) return;

  const cards = slides();
  let index = 0;

  const overlay = el("div", { class: "tour-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Welcome tour" });
  const card = el("div", { class: "tour-card" });
  const iconWrap = el("div", { class: "tour-icon" });
  const title = el("h2", { class: "tour-title" });
  const body = el("p", { class: "tour-body" });
  const dots = el("div", { class: "tour-dots" });
  const back = el("button", { class: "secondary-btn tour-back", type: "button", text: "Back" });
  const next = el("button", { class: "tour-next", type: "button", text: "Next" });
  const skip = el("button", { class: "tour-skip", type: "button", text: "Skip" });

  const close = () => {
    markSeen();
    overlay.classList.add("tour-out");
    setTimeout(() => overlay.remove(), 220);
    document.removeEventListener("keydown", onKey);
  };

  function draw() {
    const slide = cards[index];
    iconWrap.innerHTML = "";
    iconWrap.append(icon(slide.icon, 30));
    title.textContent = slide.title;
    body.textContent = slide.body;
    dots.innerHTML = "";
    cards.forEach((_, i) => dots.append(el("span", { class: `tour-dot${i === index ? " on" : ""}` })));
    back.style.visibility = index === 0 ? "hidden" : "visible";
    next.textContent = index === cards.length - 1 ? "Let's go" : "Next";
    skip.style.display = index === cards.length - 1 ? "none" : "";
    card.classList.remove("tour-pop");
    void card.offsetWidth; // restart the animation
    card.classList.add("tour-pop");
  }

  next.addEventListener("click", () => (index === cards.length - 1 ? close() : (index++, draw())));
  back.addEventListener("click", () => index > 0 && (index--, draw()));
  skip.addEventListener("click", close);

  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") next.click();
    else if (e.key === "ArrowLeft") back.click();
  };
  document.addEventListener("keydown", onKey);

  card.append(iconWrap, title, body, dots, el("div", { class: "tour-buttons" }, [back, next]), skip);
  overlay.append(card);
  document.body.append(overlay);
  draw();
}
