// The controls for a world, wherever one is shown large: play/pause,
// direction, speed, zoom, reset -- and the sun: Day, Dusk, Night or Live
// (follows your clock), the sun's angle and height, and how bright the
// night side is. Lighting is remembered on this device and shared by every
// world on the page (world-light.js).
import { el } from "../../src/util.js";
import { getLight, setLight, onLight } from "./world-light.js";
import { punch, burstOn } from "./fx.js";

let n = 0;

/**
 * @param {{setMotion: Function, getMotion: Function, zoomBy: Function, reset: Function}} globe
 * @param {{extra?: Node[], hint?: string, label?: string}} [opts]
 */
export function globeDock(globe, { extra = [], hint = "drag to spin · tip", label = "Control the world" } = {}) {
  const id = `gd${++n}`;
  const btn = (glyph, aria, title, onClick, more = {}) => {
    const b = el("button", { type: "button", class: "gd-btn", "aria-label": aria, title, ...more }, [el("span", { "aria-hidden": "true", text: glyph })]);
    b.addEventListener("click", () => {
      onClick(b);
      punch(b);
      burstOn(b, { count: 16 });
    });
    return b;
  };

  // ---- motion
  const play = btn("❚❚", "Pause the world", "Pause / play", () => globe.setMotion({ paused: !globe.getMotion().paused }), { "aria-pressed": "true", "data-gd": "play" });
  const dir = btn("⟲", "Reverse direction", "Reverse direction", () => globe.setMotion({ direction: -globe.getMotion().direction, paused: false }), { "data-gd": "dir" });
  const speed = el("input", { type: "range", id: `${id}-speed`, min: "0", max: "8", step: "0.25", value: "1", "data-gd": "speed" });
  const speedOut = el("output", { for: `${id}-speed` });
  speed.addEventListener("input", () => globe.setMotion({ speed: Number(speed.value), paused: false }));
  const speedBox = el("label", { class: "gd-speed", title: "Speed" }, [el("span", { class: "sr-only", text: "Speed" }), speed, speedOut]);
  const zoomOut = btn("−", "Zoom out", "Zoom out", () => globe.zoomBy(1 / 1.18));
  const zoomIn = btn("+", "Zoom in", "Zoom in", () => globe.zoomBy(1.18));
  const reset = btn("↺", "Reset the world", "Reset", () => globe.reset());

  // ---- light
  const panel = el("div", { class: "gd-panel", id: `${id}-light`, role: "group", "aria-label": "Light", hidden: true });
  const sunBtn = btn("☀", "Light: sun and night side", "Light", () => toggle(), { "aria-expanded": "false", "aria-controls": `${id}-light`, "data-gd": "sun" });
  const modes = [
    ["day", "Day"],
    ["dusk", "Dusk"],
    ["night", "Night"],
    ["live", "Live"],
  ];
  const modeRow = el("div", { class: "gd-modes", role: "radiogroup", "aria-label": "Time of day" });
  const slider = (key, text, min, max, step, fmt) => {
    const input = el("input", { type: "range", id: `${id}-${key}`, min, max, step, "data-light": key });
    const out = el("output", { for: `${id}-${key}` });
    input.addEventListener("input", () => setLight({ [key]: key === "night" ? Number(input.value) / 100 : Number(input.value) }));
    return { input, out, fmt, node: el("label", { class: "gd-slide" }, [el("span", {}, [el("b", { text }), out]), input]) };
  };
  const az = slider("azimuth", "Sun angle", "-180", "180", "1", (v) => `${Math.round(v)}°`);
  const elv = slider("elevation", "Sun height", "-60", "60", "1", (v) => `${Math.round(v)}°`);
  const night = slider("night", "Night side", "0", "100", "1", (v) => (v < 0.08 ? "dark" : v < 0.5 ? "starlit" : "moonlit"));
  panel.append(
    el("p", { class: "gd-panel-h", text: "Light" }),
    modeRow,
    az.node,
    elv.node,
    night.node,
    el("small", { class: "gd-note", text: "Live puts your world in daylight at noon and in darkness at midnight. Saved on this device." })
  );

  function renderLight(l = getLight()) {
    modeRow.replaceChildren(
      ...modes.map(([m, t]) =>
        el("button", { type: "button", class: "chip", role: "radio", "aria-checked": String(l.mode === m), text: t, onClick: () => setLight({ mode: m }) })
      )
    );
    az.input.value = String(l.azimuth);
    az.input.disabled = l.mode === "live";
    az.out.textContent = l.mode === "live" ? "clock" : az.fmt(l.azimuth);
    elv.input.value = String(l.elevation);
    elv.out.textContent = elv.fmt(l.elevation);
    night.input.value = String(Math.round(l.night * 100));
    night.out.textContent = night.fmt(l.night);
  }
  renderLight();
  const offLight = onLight(renderLight);

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    sunBtn.setAttribute("aria-expanded", String(open));
    if (open) panel.querySelector("[aria-checked='true']")?.focus();
  }
  const onDoc = (e) => {
    if (!panel.hidden && !dock.contains(e.target)) toggle(false);
  };
  const onKey = (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      toggle(false);
      sunBtn.focus();
    }
  };
  document.addEventListener("pointerdown", onDoc);
  document.addEventListener("keydown", onKey);

  const dock = el("div", { class: "globe-dock", role: "group", "aria-label": label }, [
    play,
    dir,
    speedBox,
    zoomOut,
    zoomIn,
    sunBtn,
    ...extra,
    reset,
    hint ? el("span", { class: "gd-hint", "aria-hidden": "true", text: hint }) : null,
    panel,
  ]);

  const sync = (m) => {
    play.setAttribute("aria-pressed", String(!m.paused));
    play.setAttribute("aria-label", m.paused ? "Play the world" : "Pause the world");
    play.firstElementChild.textContent = m.paused ? "▶" : "❚❚";
    dir.firstElementChild.textContent = m.direction > 0 ? "⟲" : "⟳";
    speed.value = String(m.speed);
    speedOut.textContent = `${+Number(m.speed).toFixed(2)}×`;
  };
  sync(globe.getMotion());

  return {
    node: dock,
    sync,
    destroy() {
      offLight();
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    },
  };
}

// A small button for a dock: an extra toggle a page adds (e.g. ribbons).
export function dockToggle(glyph, aria, pressed, onChange) {
  const b = el("button", { type: "button", class: "gd-btn", "aria-label": aria, title: aria, "aria-pressed": String(pressed) }, [el("span", { "aria-hidden": "true", text: glyph })]);
  b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    punch(b);
    onChange(on);
  });
  return b;
}
