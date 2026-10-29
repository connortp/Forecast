"""Measures how well the white hero number reads on every sky plate, and sets each plate's scrim.

For each plate (and each video poster) this crops the photo the way the apps do (cover, at the
plate's focus point) for a phone and a desktop window, darkens it by its brightness and the
shared shade gradient, and finds the brightest pixels behind the number and its two labels.
The scrim is the soft dark ellipse drawn behind the hero; its strength is the smallest value
that keeps white text at TARGET contrast against the 95th-percentile pixel.

    python3 packages/design/scripts/hero-contrast.py          # report only
    python3 packages/design/scripts/hero-contrast.py --write  # also update sky/index.json

Needs Pillow and numpy.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

SKY = Path(__file__).resolve().parent.parent / "sky"
TARGET = 3.6  # WCAG asks 3:1 for large text; a little headroom for video frames and drift
MAX_SCRIM = 0.5  # past this the ellipse shows as a smudge, so the whole plate is exposed down instead
MIN_EXPOSURE = 0.62

# Fractions of the window covered by the number and the two labels, measured from the apps.
VIEWS = {
    "phone": dict(size=(390, 844), boxes=[(0.18, 0.42, 0.82, 0.575), (0.22, 0.37, 0.78, 0.405), (0.26, 0.595, 0.74, 0.625)]),
    "desktop": dict(size=(1440, 900), boxes=[(0.33, 0.38, 0.67, 0.6), (0.4, 0.33, 0.6, 0.36), (0.42, 0.62, 0.58, 0.65)]),
}

def linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def luminance(rgb):
    l = linear(rgb)
    return 0.2126 * l[..., 0] + 0.7152 * l[..., 1] + 0.0722 * l[..., 2]

def cover(img, size, focus, zoom=1):
    w, h = size
    s = max(w / img.width, h / img.height) * zoom
    sw, sh = round(img.width * s), round(img.height * s)
    big = img.resize((sw, sh), Image.LANCZOS)
    x = round((sw - w) * focus[0]); y = round((sh - h) * focus[1])
    return np.asarray(big.crop((x, y, x + w, y + h)).convert("RGB"), dtype=np.float64)

def shade(h):
    # .sky .shade: rgba(8,10,22) .35 at 0, .08 at 40%, .5 at 100%
    y = np.linspace(0, 1, h)
    return np.interp(y, [0, 0.4, 1], [0.35, 0.08, 0.5])[:, None]

# Shared with the apps: distance out along the ellipse -> share of the scrim's strength.
SCRIM_STOPS = ([0, 0.35, 0.65, 1], [1, 0.85, 0.45, 0])

def scrim_weight(w, h):
    # The ellipse: full strength at the centre, 60% at 45% of the way out, gone at the edge.
    y, x = np.mgrid[0:h, 0:w]
    rx, ry = (0.85 if w < h else 0.42) * w, (0.19 if w < h else 0.36) * h
    d = np.sqrt(((x - w / 2) / rx) ** 2 + ((y - h / 2) / ry) ** 2)
    return np.interp(d, SCRIM_STOPS[0], SCRIM_STOPS[1])

def worst(rgb, boxes):
    h, w = rgb.shape[:2]
    lum = luminance(rgb)
    return max(np.percentile(lum[int(b[1] * h):int(b[3] * h), int(b[0] * w):int(b[2] * w)], 95) for b in boxes)

def contrast(l):
    return 1.05 / (l + 0.05)

def framing(h, view):
    """A plate's focus and zoom for this window; `wide` overrides them for landscape windows."""
    w, ht = view["size"]
    f = {**h, **h.get("wide", {})} if w > ht else h
    return f.get("focus", [0.5, 0.5]), f.get("zoom", 1)

def crops(img, h):
    """The plate as each window shows it, under the shade, plus each window's scrim weights."""
    out = []
    for view in VIEWS.values():
        rgb = cover(img, view["size"], *framing(h, view))
        H, W = rgb.shape[:2]
        out.append((rgb * (1 - shade(H))[..., None], scrim_weight(W, H)[..., None], view["boxes"]))
    return out

def measure(views, brightness, scrim):
    return [contrast(worst(rgb * brightness * (1 - scrim * wt), boxes)) for rgb, wt, boxes in views]

def main():
    index = json.loads((SKY / "index.json").read_text())
    hero = index.setdefault("hero", {})
    # Darkest brightness each plate is shown at doesn't matter; the brightest (1 unless always dimmed) does.
    dims = {}
    for times in index["conditions"].values():
        for e in times.values():
            for name in [e["plate"]] + ([e["video"]] if "video" in e else []):
                dims[name] = max(dims.get(name, 0), e.get("brightness", 1))
    files = {**index["plates"], **{k: v["poster"] for k, v in index["videos"].items()}}
    print(f"{'plate':14} {'before':>16}   scrim exposure {'after':>12}")
    for name, file in files.items():
        img = Image.open(SKY / file)
        h = hero.setdefault(name, {})
        b = dims.get(name, 1)
        views = crops(img, h)
        before = measure(views, b, 0)
        ok = lambda e, s: min(measure(views, b * e, s)) >= TARGET
        e, s = 1.0, 0.0
        while not ok(e, s):
            if s < MAX_SCRIM: s = round(s + 0.02, 2)
            elif e > MIN_EXPOSURE: e, s = round(e - 0.02, 2), 0.0
            else: break
        after = measure(views, b * e, s)
        h["scrim"], h["exposure"] = s, e
        flag = "" if min(after) >= TARGET else "  <- below target"
        print(f"{name:14} {before[0]:7.2f} {before[1]:7.2f}   {s:.2f} x{e:.2f} {after[0]:7.2f} {after[1]:7.2f}{flag}")
    if "--write" in sys.argv:
        index["hero"] = {k: hero[k] for k in files}
        (SKY / "index.json").write_text(json.dumps(index, indent=2) + "\n")
        print("wrote", SKY / "index.json")

main()
