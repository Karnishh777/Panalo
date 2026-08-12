// Location sharing, without a Google dependency.
//
// A shared location travels as a marker inside an ordinary text message, so it
// is encrypted like everything else and needs no schema change — the server
// never sees coordinates in the clear.
//
// The map itself is Leaflet + OpenStreetMap, loaded lazily the first time a
// map is actually opened, so nobody pays for it on a normal chat load.
// Note on tiles (roadmap decision #7): OSM's public tile server is fine at this
// scale but forbids production traffic. Swap TILE_URL for a provider with a
// free tier (MapTiler / Stadia) before this gets busy.
import { el, showToast } from "./util.js";
import { icon } from "./icons.js";

const MARKER = /^\[\[loc:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]\]$/;

const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";

export function locationMarker(lat, lng) {
  return `[[loc:${lat.toFixed(6)},${lng.toFixed(6)}]]`;
}

// Returns { lat, lng } or null. Coordinates are validated, not trusted.
export function parseLocation(text) {
  const m = typeof text === "string" ? text.trim().match(MARKER) : null;
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function describeLocation(text) {
  return parseLocation(text) ? "📍 Location" : text;
}

// Ask the device where it is. Resolves null (with a toast) on any refusal.
export function getCurrentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      showToast("This browser can't share location.");
      return resolve(null);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          showToast("Location permission was blocked — allow it in your browser's site settings.");
        } else if (err.code === err.TIMEOUT) {
          showToast("Couldn't get a location fix. Try again outdoors.");
        } else {
          showToast("Couldn't determine your location.");
        }
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}

// The card shown inside a message bubble.
export function locationCard({ lat, lng }) {
  const card = el("div", { class: "location-card" }, [
    el("span", { class: "location-pin" }, [icon("pin", 22)]),
    el("div", { class: "location-meta" }, [
      el("div", { class: "location-title", text: "Shared location" }),
      el("div", { class: "location-coords", text: `${lat.toFixed(5)}, ${lng.toFixed(5)}` }),
    ]),
  ]);
  card.addEventListener("click", (e) => {
    e.stopPropagation();
    openMap(lat, lng);
  });
  return card;
}

// ---- Map modal (Leaflet loaded on first use) ----
let leafletReady = null;
let map = null;
let marker = null;

function loadLeaflet() {
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = LEAFLET_CSS;
    document.head.append(css);

    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("leaflet failed"));
    document.head.append(script);
  });
  return leafletReady;
}

export async function openMap(lat, lng) {
  const modal = document.getElementById("map-modal");
  modal.classList.remove("hidden");
  document.getElementById("map-coords").textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  // Always offer a way out, even if tiles never load.
  document.getElementById("map-open-external").href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

  let L;
  try {
    L = await loadLeaflet();
  } catch {
    showToast("Map couldn't load — use “Open in maps”.");
    return;
  }

  const host = document.getElementById("map-canvas");
  if (!map) {
    map = L.map(host, { attributionControl: true }).setView([lat, lng], 16);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    marker = L.marker([lat, lng]).addTo(map);
  } else {
    map.setView([lat, lng], 16);
    marker.setLatLng([lat, lng]);
  }
  // The container was hidden while Leaflet measured it.
  setTimeout(() => map.invalidateSize(), 60);
}

export function initLocation() {
  document.getElementById("close-map-modal").addEventListener("click", () => {
    document.getElementById("map-modal").classList.add("hidden");
  });
}
