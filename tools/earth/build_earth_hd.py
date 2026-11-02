"""Build the sharper real-Earth maps for Panalo Students' world (v0.3).

Adds to students/assets/earth/ what build_earth.py doesn't make:
  earth-albedo-4096.jpg   surface colour, for strong laptops
  earth-lights-4096.jpg   night lights, from the 3 km Black Marble
  earth-emerge-4096.png   the order land rises (the 2048 map, enlarged)
  earth-relief-{N}.jpg    land elevation (grey), so mountains and valleys
                          catch the sun
  earth-clouds-{N}.jpg    real cloud cover, the weather's starting point

Sources (all public domain, NASA):
  - Blue Marble Next Generation, July 2004, topography and bathymetry, 5400x2700:
    https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x5400x2700.jpg
  - Black Marble 2016, 3 km:
    https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg
  - GEBCO 2008 elevation (revised), 21600x10800:
    https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_21600x10800.png
  - Blue Marble clouds, 2048:
    https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg

Usage: python3 tools/earth/build_earth_hd.py <source dir> <students/assets/earth>
(needs Pillow and numpy)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
Image.MAX_IMAGE_PIXELS = None


def save_jpg(img, name, q=86):
    img.save(OUT / name, quality=q, optimize=True, progressive=True)
    print(name, (OUT / name).stat().st_size)


# Surface colour, 4096.
albedo = Image.open(SRC / "bluemarble-5400.jpg").convert("RGB").resize((4096, 2048), Image.LANCZOS)
save_jpg(albedo, "earth-albedo-4096.jpg", 85)

# Night lights, 4096: as build_earth.py, the smooth moonlit background
# (ice, desert) taken out with a grey opening wider than a city.
lights = Image.open(SRC / "blackmarble-3km.jpg").convert("L").resize((4096, 2048), Image.LANCZOS)
bg = lights.filter(ImageFilter.MinFilter(13)).filter(ImageFilter.MaxFilter(13))
src = np.asarray(lights, dtype=np.float32) / 255.0
src = np.clip(src - np.minimum(np.asarray(bg, dtype=np.float32) / 255.0, 0.16), 0, 1)
src = np.clip((src - 0.03) / 0.97, 0, 1) ** 1.15
save_jpg(Image.fromarray((src * 255).astype(np.uint8), "L"), "earth-lights-4096.jpg", 88)

# The order land rises, 4096: the 2048 map enlarged, kept to its coast.
e = Image.open(OUT / "earth-emerge-2048.png").convert("L")
big = np.asarray(e.resize((4096, 2048), Image.BILINEAR))
near = np.asarray(e.resize((4096, 2048), Image.NEAREST))
val = np.where(near > 0, np.maximum(big, 1), 0).astype(np.uint8)
Image.fromarray(val, "L").save(OUT / "earth-emerge-4096.png", optimize=True)
print("earth-emerge-4096.png", (OUT / "earth-emerge-4096.png").stat().st_size)

# Relief: land elevation, gently lifted so the lowlands still show shape.
elev = Image.open(SRC / "gebco-elev-21600.png").convert("L")
for n in (1024, 2048, 4096):
    r = elev.resize((n, n // 2), Image.LANCZOS)
    a = np.asarray(r, dtype=np.float32) / 255.0
    a = np.clip(a, 0, 1) ** 0.75
    save_jpg(Image.fromarray((a * 255).astype(np.uint8), "L"), f"earth-relief-{n}.jpg", 88)

# Real clouds, the weather's starting point.
clouds = Image.open(SRC / "clouds-2048.jpg").convert("L")
for n in (1024, 2048):
    save_jpg(clouds.resize((n, n // 2), Image.LANCZOS), f"earth-clouds-{n}.jpg", 84)
