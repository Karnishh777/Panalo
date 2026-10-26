// Keeps the app smooth on slower machines. On a low-tier device, or when
// frames are seen running slow once the app has settled, html[data-lite]
// turns off the costliest painting (backdrop blur, looping animations);
// see base.css. It is checked once a visit and never turned back on.
import { deviceTier } from "./device-tier.js";

let started = false;

export function guardFrames() {
  if (started) return;
  started = true;
  const root = document.documentElement;
  if (deviceTier().tier === "low") return root.setAttribute("data-lite", "");
  let last = 0;
  let frames = 0;
  let slow = 0;
  const tick = (t) => {
    // A hidden tab doesn't draw; start the count again when it's back.
    if (document.hidden || !last) last = t;
    else {
      frames++;
      if (t - last > 50) slow++;
      last = t;
    }
    if (frames < 120) return requestAnimationFrame(tick);
    if (slow / frames > 0.25) root.setAttribute("data-lite", "");
  };
  // Not while the app is still loading: that would count as slow.
  setTimeout(() => requestAnimationFrame(tick), 4000);
}
