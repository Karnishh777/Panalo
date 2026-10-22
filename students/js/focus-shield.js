// The focus shield: while a focus block runs, the rest of Panalo keeps out
// of the way -- wherever you are in the app, not only in the Study Room.
//
//   - no unread counts in the bar or the dock (css/details.css, html.focusing);
//   - nothing celebrates, and no dawn or weekly story plays, until the
//     block ends (moment.js and shell.js ask focusing());
//   - on any other page, one quiet line under the bar says how long is
//     left, and goes back to the Study Room.
//
// A paused block isn't shielded: you've stepped away on purpose.
import { el } from "./ui.js";
import { store } from "./store.js";
import { loadTimer, onTimer } from "./timer-state.js";
import { remaining } from "./model/focus-timer.js";

/** Is a focus block running right now? */
export function focusing(now = Date.now()) {
  const t = loadTimer();
  return t.phase === "focus" && t.status === "running" && remaining(t, now) > 0;
}

let line = null;
let tick = 0;
let off = null;

function render() {
  const now = Date.now();
  const on = focusing(now);
  document.documentElement.classList.toggle("focusing", on);
  if (!line) return;
  if (!on) {
    line.replaceChildren();
    return;
  }
  const t = loadTimer();
  const left = Math.max(1, Math.ceil(remaining(t, now) / 60000));
  const task = t.taskId ? (store.tasks || []).find((x) => x.id === t.taskId) : null;
  const what = task?.title || t.subject || "";
  line.setAttribute("aria-label", `Focusing${what ? ` on ${what}` : ""}, ${left} minutes left. Back to the Study Room.`);
  line.replaceChildren(
    el("span", { class: "focus-line-dot", "aria-hidden": "true" }),
    el("span", { "aria-hidden": "true" }, ["Focusing", what ? ` on ${what}` : "", " — ", el("b", { text: `${left} min left` })]),
    el("u", { "aria-hidden": "true", text: "Back to it" })
  );
}

export function startFocusShield() {
  if (!line) {
    line = el("a", { class: "focus-line", href: "#/study" });
    document.getElementById("app")?.prepend(line);
  }
  render();
  off ??= onTimer(render);
  clearInterval(tick);
  tick = setInterval(render, 20000);
}

export function stopFocusShield() {
  clearInterval(tick);
  off?.();
  off = null;
  line?.remove();
  line = null;
  document.documentElement.classList.remove("focusing");
}
