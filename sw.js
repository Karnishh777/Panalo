// Service worker: offline shell + notifications that survive a backgrounded tab.
//
// Notifications raised through the service worker registration behave like real
// app notifications — they land in the OS notification centre and stay there
// until dismissed, where a page-created Notification can be discarded as soon
// as the tab loses focus. That's why alerts weren't showing up on the desktop.
//
// Scope note: this makes notifications reliable while PANALO is OPEN in a tab
// (even a background one). Notifications with the browser fully closed need Web
// Push (VAPID keys + a server to push from) — see ROADMAP Phase 9.

const CACHE = "panalo-shell-v1";

// The app shell only. Messages and images are never cached: they're private,
// and stale chat content would be worse than none.
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./crypto.js",
  "./logo.svg",
  "./doodle.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for our own files so a deploy is picked up immediately, with
// the cache as the fallback when the network isn't there. Anything
// cross-origin (Supabase, fonts, tiles) is left entirely alone.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit || caches.match("./index.html"))
      )
  );
});

// The page asks the worker to raise a notification, because a notification
// raised here outlives the tab losing focus.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "notify") return;
  self.registration.showNotification(data.title || "Panalo", {
    body: data.body || "",
    icon: data.icon,
    badge: data.icon,
    tag: data.tag,
    renotify: true,
    data: { conversationId: data.conversationId },
  });
});

// Clicking a notification focuses an existing tab (and tells it which chat to
// open) rather than launching a second copy of the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const convId = event.notification.data?.conversationId;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "open-chat", conversationId: convId });
          return client.focus();
        }
      }
      return self.clients.openWindow("./");
    })
  );
});
