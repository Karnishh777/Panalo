// Connection state and recovery.
//
// Realtime delivery is best-effort. A dropped socket, a sleeping laptop, a
// backgrounded mobile tab, a tunnel — all of them mean postgres_changes
// events are simply never delivered. Nothing in the app noticed: every
// subscription was fire-and-forget, so a message sent during a gap stayed
// invisible until the user happened to reload. That is silent message loss,
// the worst failure mode a messenger can have.
//
// This module owns three things and nothing else:
//   1. what connection state we're in,
//   2. when that state should be re-checked,
//   3. telling the rest of the app to reconcile itself with the server.
//
// It deliberately does NOT know about messages, conversations, or the DOM
// beyond its own status pill — subscribers register what reconciling means
// for them.

import { el } from "./util.js";

export const ConnectionState = {
  ONLINE: "online",
  OFFLINE: "offline",
  RECONNECTING: "reconnecting",
  SYNCING: "syncing",
};

// How long a channel may sit in a non-subscribed state before we stop
// calling it a blip and tell the user we're reconnecting.
const RECONNECT_GRACE_MS = 2000;
// Coalesce triggers that arrive together (network back + tab focused +
// channel resubscribed) into a single reconciliation pass.
const RESYNC_DEBOUNCE_MS = 400;

const channelStatus = new Map(); // channel name -> last reported status
const resyncHandlers = new Set();

let state = navigator.onLine === false ? ConnectionState.OFFLINE : ConnectionState.ONLINE;
let pill = null;
let graceTimer = null;
let resyncTimer = null;
let resyncing = false;
let listener = null;

export function getConnectionState() {
  return state;
}

// Register a callback that reconciles some part of the app with the server.
// Handlers may be async; failures are contained so one broken handler can't
// stop the others from recovering.
export function onResync(handler) {
  resyncHandlers.add(handler);
  return () => resyncHandlers.delete(handler);
}

export function setConnectionListener(fn) {
  listener = fn;
}

function isUnhealthy(status) {
  return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED";
}

function setState(next) {
  if (state === next) return;
  state = next;
  renderPill();
  listener?.(next);
}

// Every realtime channel reports its subscribe() status here, so connection
// health is derived from what the sockets are actually doing rather than
// from navigator.onLine alone — which only knows about the network
// interface, not whether our server is reachable.
export function reportChannelStatus(name, status) {
  const previous = channelStatus.get(name);
  channelStatus.set(name, status);

  if (status === "SUBSCRIBED") {
    clearTimeout(graceTimer);
    // A channel that subscribes again after being unhealthy is the clearest
    // signal we may have missed events while it was down.
    if (previous && isUnhealthy(previous)) requestResync("channel-resubscribed");
    if (![...channelStatus.values()].some(isUnhealthy)) setState(ConnectionState.ONLINE);
    return;
  }

  if (!isUnhealthy(status)) return;
  if (navigator.onLine === false) {
    setState(ConnectionState.OFFLINE);
    return;
  }
  // Don't flash "Reconnecting" for a blip that resolves immediately.
  clearTimeout(graceTimer);
  graceTimer = setTimeout(() => {
    if ([...channelStatus.values()].some(isUnhealthy)) setState(ConnectionState.RECONNECTING);
  }, RECONNECT_GRACE_MS);
}

// Drop a channel we've torn down, so a stale CLOSED status can't keep the
// app stuck reporting "Reconnecting" forever.
export function forgetChannel(name) {
  channelStatus.delete(name);
  if (![...channelStatus.values()].some(isUnhealthy) && state === ConnectionState.RECONNECTING) {
    setState(ConnectionState.ONLINE);
  }
}

export function requestResync(reason = "manual") {
  clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => runResync(reason), RESYNC_DEBOUNCE_MS);
}

async function runResync(reason) {
  if (resyncing || navigator.onLine === false || !resyncHandlers.size) return;
  resyncing = true;
  setState(ConnectionState.SYNCING);
  // allSettled: one failing handler must not abort the others' recovery.
  await Promise.allSettled([...resyncHandlers].map((fn) => fn(reason)));
  resyncing = false;
  setState(navigator.onLine === false ? ConnectionState.OFFLINE : ConnectionState.ONLINE);
}

// ---- Status pill ----
// The app should never hide the fact that it's out of touch with the
// server. Silence is what let dropped messages go unnoticed to begin with.
const PILL_COPY = {
  [ConnectionState.OFFLINE]: "Offline",
  [ConnectionState.RECONNECTING]: "Reconnecting…",
  [ConnectionState.SYNCING]: "Syncing…",
};

function renderPill() {
  const copy = PILL_COPY[state];
  if (!copy) {
    pill?.remove();
    pill = null;
    return;
  }
  if (!pill) {
    pill = el("div", { class: "connection-pill", role: "status", "aria-live": "polite" });
    document.body.append(pill);
  }
  pill.dataset.state = state;
  pill.textContent = copy;
}

export function startConnectionWatch() {
  window.addEventListener("offline", () => setState(ConnectionState.OFFLINE));
  window.addEventListener("online", () => {
    setState(ConnectionState.RECONNECTING);
    requestResync("network-online");
  });

  // Returning to a backgrounded tab is the most common way to arrive with a
  // stale view: mobile browsers freeze timers and sockets aggressively.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) requestResync("tab-visible");
  });

  renderPill();
}
