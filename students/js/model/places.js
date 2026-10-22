// Friends on the globe: finding a city by name, how long a place is shared,
// and how to say it. Pure (tests/students-model.test.mjs).
//
// A city row is [name, region, country, lat, lon, population], biggest
// first (assets/earth/cities.json, from Natural Earth).

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** How long a place stays shared: until turned off, a week, or a day. */
export const SHARE_FOR = [
  { id: "off", label: "Until I turn it off" },
  { id: "7d", label: "7 days" },
  { id: "24h", label: "24 hours" },
];

export function expiryFor(choice, now = Date.now()) {
  if (choice === "7d") return new Date(now + 7 * 86400000).toISOString();
  if (choice === "24h") return new Date(now + 86400000).toISOString();
  return null;
}

/** "until you turn it off", "for 23 more hours", "until Thu 29 Oct". */
export function untilText(expiresAt, now = Date.now()) {
  if (!expiresAt) return "until you turn it off";
  const left = Date.parse(expiresAt) - now;
  if (left <= 0) return "no longer";
  if (left < 3600000) return `for ${Math.max(1, Math.round(left / 60000))} more min`;
  if (left < 36 * 3600000) {
    const h = Math.round(left / 3600000);
    return `for ${h} more hour${h === 1 ? "" : "s"}`;
  }
  return `until ${new Date(expiresAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
}

/** The choice that an existing expiry is closest to (for editing). */
export function shareChoiceOf(expiresAt, now = Date.now()) {
  if (!expiresAt) return "off";
  return Date.parse(expiresAt) - now > 36 * 3600000 ? "7d" : "24h";
}

/**
 * Cities matching what someone typed: "chen", "hyderabad india",
 * "Sao Paulo" (accents optional). The first word must start the city's
 * name or one of its words; any others can match its region or country.
 * Bigger cities first among equally good matches.
 */
export function searchCities(rows, query, limit = 8) {
  const words = fold(query).split(/[\s,]+/).filter(Boolean);
  if (!words.length || !rows?.length) return [];
  const [first, ...rest] = words;
  const scored = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = fold(r[0]);
    let rank;
    if (name === words.join(" ")) rank = 0;
    else if (name.startsWith(first)) rank = 1;
    else if (name.split(/[\s-]+/).some((w) => w.startsWith(first))) rank = 2;
    else continue;
    if (rest.length) {
      const where = `${name} ${fold(r[1])} ${fold(r[2])}`;
      if (!rest.every((w) => where.includes(w))) continue;
    }
    scored.push([rank, i]);
    if (rank === 0 && scored.length > limit * 4) break;
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map(([, i]) => rowToCity(rows[i]));
}

export function rowToCity(r) {
  return { city: r[0], region: r[1] || "", country: r[2] || "", lat: r[3], lon: r[4] };
}

/** "Chennai, Tamil Nadu, India" without repeats ("Singapore, Singapore"). */
export function placeLabel(p) {
  const parts = [p.city, p.region, p.country].filter(Boolean);
  return parts.filter((x, i) => parts.indexOf(x) === i).join(", ");
}
