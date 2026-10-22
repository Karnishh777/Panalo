"""Build the real-Earth textures for Panalo Students' world (students/assets/earth/).

Sources (all public domain):
  - NASA Blue Marble Next Generation, July 2004, with topography and
    bathymetry, 5400x2700 (Reto Stockli, NASA Earth Observatory):
    https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x5400x2700.jpg
  - NASA Black Marble 2016, 0.1 degree (city lights at night):
    https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg
  - Natural Earth 1:10m land polygons:
    https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip

Outputs, equirectangular, north up, longitude -180..180 left to right:
  earth-albedo-{N}.jpg   the surface colour
  earth-lights-{N}.jpg   night lights (grey)
  earth-emerge-{N}.png   the order land rises from the sea: 0 is ocean; on
                         land, 255 rises first and 1 last. A world starts as
                         ocean and, as focus grows, land appears where this
                         value is above (1 - progress) -- India first, then
                         outward across the world, each landmass growing from
                         its interior to its real coast. Values are
                         area-weighted ranks, so "progress 0.3" is 30% of
                         Earth's land.

Usage: python3 tools/earth/build_earth.py <source dir> <output dir>
(needs Pillow, numpy, scipy, pyshp)
"""
import math
import sys
from pathlib import Path

import numpy as np
import shapefile
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
Image.MAX_IMAGE_PIXELS = None

# Home: the middle of India. Land nearest it rises first.
HOME_LAT, HOME_LON = 21.0, 79.0


def land_mask(w, h):
    """Natural Earth land, rasterised at 2x and filtered down (anti-aliased)."""
    W, H = w * 2, h * 2
    img = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(img)
    sf = shapefile.Reader(str(SRC / "ne10" / "ne_10m_land.shp"))
    for shape in sf.shapes():
        pts = shape.points
        parts = list(shape.parts) + [len(pts)]
        for a, b in zip(parts[:-1], parts[1:]):
            ring = [((x + 180) / 360 * W, (90 - y) / 180 * H) for x, y in pts[a:b]]
            if len(ring) >= 3:
                draw.polygon(ring, fill=255)
    # Holes (lakes inside land) are drawn as land: the world is about land
    # rising, and inland lakes at this scale are a few pixels.
    return img.resize((w, h), Image.LANCZOS)


def emergence(mask_small):
    m = np.asarray(mask_small, dtype=np.float32) / 255.0
    h, w = m.shape
    land = m > 0.5
    lat = (90 - (np.arange(h) + 0.5) / h * 180)[:, None] * math.pi / 180
    lon = (-180 + (np.arange(w) + 0.5) / w * 360)[None, :] * math.pi / 180
    # Angular distance from home (radians), 0..pi.
    hl, hn = math.radians(HOME_LAT), math.radians(HOME_LON)
    cosd = np.sin(lat) * math.sin(hl) + np.cos(lat) * math.cos(hl) * np.cos(lon - hn)
    d_home = np.arccos(np.clip(cosd, -1, 1))
    # Distance to the coast, in km (pixel distance scaled by latitude).
    px_km = 40075.0 / w
    dt = ndimage.distance_transform_edt(land) * px_km
    interior = np.clip(dt / 600.0, 0, 1)
    # A little organic variation, so the frontier isn't a perfect circle.
    rng = np.random.default_rng(7)
    noise = ndimage.gaussian_filter(rng.random((h, w)).astype(np.float32), 6)
    noise = (noise - noise.mean()) / (noise.std() + 1e-6)
    score = 0.86 * (1 - d_home / math.pi) + 0.14 * interior + 0.02 * noise
    # Area-weighted rank among land cells -> 1 (rises first) .. ~0 (last).
    area = np.broadcast_to(np.cos(lat), (h, w))
    idx = np.flatnonzero(land)
    order = idx[np.argsort(-score.ravel()[idx])]
    cum = np.cumsum(area.ravel()[order])
    cum /= cum[-1]
    e = np.zeros(h * w, dtype=np.float32)
    e[order] = 1.0 - cum + cum[0]
    return e.reshape(h, w), land


def build(n):
    w, h = n, n // 2
    print(f"-- {w}x{h}")
    mask = land_mask(w, h)
    small = mask.resize((1024, 512), Image.LANCZOS) if w > 1024 else mask
    e_small, _ = emergence(small)
    # Up to full size, smoothly, then cut to the real (anti-aliased) coast.
    e_full = np.asarray(Image.fromarray((e_small * 65535).astype(np.uint16)).resize((w, h), Image.BILINEAR), dtype=np.float32) / 65535
    m = np.asarray(mask, dtype=np.float32) / 255.0
    val = np.where(m > 0.5, 1 + np.round(np.clip(e_full, 0, 1) * 254), 0).astype(np.uint8)
    Image.fromarray(val, "L").save(OUT / f"earth-emerge-{n}.png", optimize=True)

    albedo = Image.open(SRC / "world.topo.bathy.200407.3x5400x2700.jpg").convert("RGB").resize((w, h), Image.LANCZOS)
    albedo.save(OUT / f"earth-albedo-{n}.jpg", quality=86, optimize=True, progressive=True)

    # The Black Marble composite keeps moonlit ice and desert faintly
    # visible (Greenland, the Sahara): that's scenery, not cities. Take out
    # the smooth background (a grey opening wider than a city, ~120 km),
    # capped so dense lit regions like the Low Countries keep their glow.
    src = np.asarray(Image.open(SRC / "BlackMarble_2016_01deg.jpg").convert("L"), dtype=np.float32) / 255.0
    bg = ndimage.grey_opening(src, size=(11, 11), mode="wrap")
    src = np.clip(src - np.minimum(bg, 0.16), 0, 1)
    lights = Image.fromarray((src * 255).astype(np.uint8), "L").resize((w, h), Image.LANCZOS)
    # Lift the faint glow out of the JPEG floor; keep the cores.
    arr = np.asarray(lights, dtype=np.float32) / 255.0
    arr = np.clip((arr - 0.03) / 0.97, 0, 1) ** 1.15
    Image.fromarray((arr * 255).astype(np.uint8), "L").save(OUT / f"earth-lights-{n}.jpg", quality=88, optimize=True)


for size in (1024, 2048):
    build(size)
for f in sorted(OUT.iterdir()):
    print(f.name, f.stat().st_size)
