// Once a year, a reminder of the community rules and what happens when
// they're broken (IT Rules 2021, r.3(1)(f)). A small card, not a wall:
// people who just agreed at sign-up don't see it for a year.
import { el, getPrefs, setPrefs } from "./ui.js";

const YEAR = 365 * 24 * 3600 * 1000;

export function rulesReminder({ firstTime = false } = {}) {
  const seen = Number(getPrefs().rulesSeenAt || 0);
  if (firstTime || !seen) {
    // Agreed at sign-up (or the first time this account opens Students).
    if (!seen) setPrefs({ rulesSeenAt: Date.now() });
    if (firstTime) return;
  }
  if (seen && Date.now() - seen < YEAR) return;
  const card = el("aside", { class: "rules-card", role: "status" }, [
    el("b", { text: "A yearly reminder" }),
    el("p", { text: "Be kind, keep personal details to yourself, and never share anything sexual, hateful or illegal. Breaking the rules can get a message removed or an account suspended." }),
    el("div", { class: "rules-card-actions" }, [
      el("a", { href: "rules.html", target: "_blank", rel: "noopener", text: "Read the rules" }),
      el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Got it", onClick: () => (setPrefs({ rulesSeenAt: Date.now() }), card.remove()) }),
    ]),
  ]);
  document.getElementById("app").append(card);
}
