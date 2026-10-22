"""Build the city list for "Where I am" (students/assets/earth/cities.json).

Source (public domain): Natural Earth 1:10m populated places, simple:
  https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places_simple.zip

Each row is [name, region, country, lat, lon, population], coordinates to
two decimals (about a kilometre) -- the city's own published centre, never
where anyone actually is. Sorted by population, biggest first, so a search
lists the likely city before the village of the same name.

Usage: python3 -I tools/earth/build_cities.py <dir with the unzipped .shp> <output.json>
(needs pyshp)
"""
import json
import sys
from pathlib import Path

import shapefile

src, out = Path(sys.argv[1]), Path(sys.argv[2])
r = shapefile.Reader(str(src / "ne_10m_populated_places_simple.shp"), encoding="utf-8")
names = [f[0] for f in r.fields[1:]]
rows = []
seen = set()
for rec in r.records():
    d = dict(zip(names, rec))
    name = (d.get("name") or "").strip()
    if not name:
        continue
    region = (d.get("adm1name") or "").strip()
    country = (d.get("adm0name") or "").strip()
    lat, lon = round(float(d["latitude"]), 2), round(float(d["longitude"]), 2)
    key = (name, region, country)
    if key in seen:
        continue
    seen.add(key)
    rows.append([name, region, country, lat, lon, int(d.get("pop_max") or 0)])
rows.sort(key=lambda x: -x[5])
out.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(rows), "cities,", out.stat().st_size, "bytes")
