// Friends on the globe (phase 27): your city, who may see it and for how
// long; and the cities your friends chose to show you.
//
// A place is a city picked by hand from a list -- never the device's
// location -- with that city's published coordinates. Only people from
// your one-to-one chats can be chosen, and the database decides who can
// read it (supabase-phase27.sql).
import { supabaseClient } from "../../src/client.js";
import { state } from "../../src/state.js";
import { store } from "./store.js";
import { expiryFor } from "./model/places.js";

const CITIES = new URL("../assets/earth/cities.json", import.meta.url);
let cityRows = null;

/** The city list, fetched the first time someone opens the picker. */
export function loadCities() {
  cityRows ||= fetch(CITIES.href)
    .then((r) => {
      if (!r.ok) throw new Error("The city list didn't load. Try again.");
      return r.json();
    })
    .catch((e) => {
      cityRows = null;
      throw e;
    });
  return cityRows;
}

/** People you can show your city to: everyone you have a one-to-one chat with. */
export function directFriends() {
  const seen = new Map();
  for (const c of store.conversations || []) {
    if (c.type === "direct" && c.otherUserId && !seen.has(c.otherUserId)) seen.set(c.otherUserId, { id: c.otherUserId, name: c.displayTitle || c.name || "Someone" });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const FIELDS = "user_id, city, region, country, lat, lon, expires_at, updated_at";

/**
 * { mine, viewers: [ids], friends: [{ id, name, city, ..., lat, lon }],
 *   available } -- available is false when phase 27 isn't applied yet.
 */
export async function loadPlaces() {
  const me = state.currentUser?.id;
  const [places, viewers] = await Promise.all([
    supabaseClient.from("student_places").select(FIELDS),
    supabaseClient.from("student_place_viewers").select("viewer_id"),
  ]);
  if (places.error || viewers.error) return { mine: null, viewers: [], friends: [], available: false };
  const now = Date.now();
  const rows = (places.data || []).map((p) => ({ ...p, lat: Number(p.lat), lon: Number(p.lon) }));
  const mine = rows.find((p) => p.user_id === me) || null;
  const others = rows.filter((p) => p.user_id !== me && (!p.expires_at || Date.parse(p.expires_at) > now));
  const names = new Map(directFriends().map((f) => [f.id, f.name]));
  const unknown = others.filter((p) => !names.has(p.user_id)).map((p) => p.user_id);
  if (unknown.length) {
    const { data } = await supabaseClient.from("profiles").select("id, username").in("id", unknown);
    (data || []).forEach((p) => names.set(p.id, p.username));
  }
  const friends = others
    .map((p) => ({ ...p, id: p.user_id, name: names.get(p.user_id) || "A friend" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { mine: mine && (!mine.expires_at || Date.parse(mine.expires_at) > now) ? mine : null, viewers: (viewers.data || []).map((v) => v.viewer_id), friends, available: true };
}

/** Show your city: { city, region, country, lat, lon }, to `viewerIds`, for `choice`. */
export async function savePlace(place, viewerIds, choice) {
  const me = state.currentUser.id;
  const row = {
    user_id: me,
    city: place.city,
    region: place.region || "",
    country: place.country || "",
    lat: Math.round(place.lat * 100) / 100,
    lon: Math.round(place.lon * 100) / 100,
    expires_at: expiryFor(choice),
  };
  const { error } = await supabaseClient.from("student_places").upsert(row, { onConflict: "user_id" });
  if (error) throw error;
  const { data: had } = await supabaseClient.from("student_place_viewers").select("viewer_id");
  const before = new Set((had || []).map((v) => v.viewer_id));
  const after = new Set(viewerIds);
  const gone = [...before].filter((id) => !after.has(id));
  const added = [...after].filter((id) => !before.has(id));
  if (gone.length) {
    const { error: e } = await supabaseClient.from("student_place_viewers").delete().eq("owner_id", me).in("viewer_id", gone);
    if (e) throw e;
  }
  if (added.length) {
    const { error: e } = await supabaseClient.from("student_place_viewers").insert(added.map((id) => ({ owner_id: me, viewer_id: id })));
    if (e) throw e;
  }
}

/** Stop showing your city: the place and the list of who could see it both go. */
export async function turnOffPlace() {
  const me = state.currentUser.id;
  const a = await supabaseClient.from("student_places").delete().eq("user_id", me);
  if (a.error) throw a.error;
  const b = await supabaseClient.from("student_place_viewers").delete().eq("owner_id", me);
  if (b.error) throw b.error;
}
