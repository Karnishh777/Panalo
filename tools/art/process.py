#!/usr/bin/env python3
"""Turn generated art into web files for Panalo Students.

    python3 -I tools/art/process.py art-source/

Originals live in art-source/ (kept as made, never served by the app).

Each input is named as in students/assets/art/PROMPTS.md (pan-idle.png,
guardian-physics.png, scene-art.png, wall-wide.png ...). Cut-outs (pan-*,
guardian-*) have their chroma-green background keyed out, with soft
edges and the green spill on the rim removed; everything is resized and
written as WebP to students/assets/art/, and manifest.json lists what
exists, so the app only asks for images that are really there.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parents[2] / "students" / "assets" / "art"
# Big enough for sharp retina screens: the wallpaper up to 4K, scenes at 1440p.
SIZES = {"pan": (1200, 1200), "guardian": (1200, 1800), "scene": (2560, 1440), "wall": (3840, 3840)}
QUALITY = 92  # WebP; visually lossless for painted art
KNOWN = {
    "pan": ["idle", "cheer", "think", "sleep"],
    "guardian": ["physics", "chemistry", "biology", "maths", "computing", "commerce", "words", "art"],
    "scene": ["physics", "chemistry", "biology", "maths", "computing", "commerce", "words", "art"],
    "wall": ["wide", "tall"],
}


def key_green(img):
    """Chroma key: alpha from how much greener than red/blue a pixel is."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            spill = g - max(r, b)
            if spill > 70:
                px[x, y] = (0, 0, 0, 0)
            elif spill > 20:
                a = int(255 * (70 - spill) / 50)
                g2 = max(r, b)  # pull the green back to neutral on the edge
                px[x, y] = (r, g2, b, a)
    # Soften the edge a touch so the cut-out sits naturally on dark.
    alpha = img.getchannel("A").filter(ImageFilter.GaussianBlur(0.8))
    img.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    return img.crop(bbox) if bbox else img


def fit(img, box):
    img = img.copy()
    img.thumbnail(box, Image.LANCZOS)
    return img


def unmark(img, cutout):
    """Remove the generator's small corner mark (bottom right). Cut-outs get
    the corner painted with their own background green; paintings are
    trimmed by a few percent on the right and bottom."""
    w, h = img.size
    if cutout:
        img = img.convert("RGB")
        bg = img.getpixel((8, 8))
        box = (int(w * 0.9), int(h * 0.93), w, h)
        img.paste(bg, box)
        return img
    return img.crop((0, 0, int(w * 0.955), int(h * 0.955)))


def process(path):
    stem = path.stem.lower().replace("_", "-")
    kind, _, name = stem.partition("-")
    if kind not in KNOWN or name not in KNOWN[kind]:
        print(f"skip {path.name}: not a name from PROMPTS.md")
        return None
    img = Image.open(path)
    cutout = kind in ("pan", "guardian")
    img = unmark(img, cutout)
    img = key_green(img) if cutout else img.convert("RGB")
    img = fit(img, SIZES[kind])
    out = OUT / f"{stem}.webp"
    img.save(out, "WEBP", quality=QUALITY, method=6)
    print(f"ok   {path.name} -> {out.name} {img.size[0]}x{img.size[1]}")
    return stem


def main(args):
    OUT.mkdir(parents=True, exist_ok=True)
    paths = []
    for a in args:
        p = Path(a)
        paths += sorted(p.glob("*.png")) + sorted(p.glob("*.jpg")) + sorted(p.glob("*.webp")) if p.is_dir() else [p]
    for p in paths:
        process(p)
    have = sorted(f.stem for f in OUT.glob("*.webp"))
    (OUT / "manifest.json").write_text(json.dumps({"files": have}, indent=2) + "\n")
    print(f"manifest: {len(have)} images")


if __name__ == "__main__":
    main(sys.argv[1:])
