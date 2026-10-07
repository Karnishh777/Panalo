// The cinema: looks that are more than a skin -- a whole scene living
// behind the app, with a camera that moves between pages.
//
// Each cinematic look has an engine (a module with start() -> { stop() })
// that is only downloaded when that look is chosen. This file starts the
// right one while the app is open, swaps it when the look changes, and
// stops it on sign-out.
import { onLook } from "../looks.js";

const ENGINES = {
  odyssey: () => import("./odyssey.js"),
};

let active = false;
let off = null;
let current = null; // { look, engine }

export function startCinema() {
  active = true;
  off ??= onLook(sync);
  sync();
}

export function stopCinema() {
  active = false;
  teardown();
}

async function sync() {
  const look = document.documentElement.dataset.look;
  if (active && current?.look === look) return;
  teardown();
  if (!active || !ENGINES[look]) return;
  const token = { look, engine: null };
  current = token;
  try {
    const mod = await ENGINES[look]();
    if (current !== token) return; // the look changed again while loading
    token.engine = mod.start();
  } catch (e) {
    console.error("cinema", e);
  }
}

function teardown() {
  current?.engine?.stop();
  current = null;
}
