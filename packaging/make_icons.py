"""Renders Reqly's icons (same geometry as src/main/resources/static/favicon.svg).

Usage: python3 packaging/make_icons.py   (needs Pillow; macOS `iconutil` for the .icns)
"""
import os, subprocess, tempfile
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 16  # supersampling: 64-unit grid -> 1024px

def render(px, tile=True, rounded=True):
    img = Image.new("RGBA", (64 * S, 64 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if tile:
        d.rounded_rectangle([0, 0, 64 * S - 1, 64 * S - 1], radius=14 * S if rounded else 0, fill="#1e1e2e")
    def line(x1, y1, x2, y2, c, w=6):
        d.line([(x1 * S, y1 * S), (x2 * S, y2 * S)], fill=c, width=w * S)
        r = w * S / 2
        for x, y in ((x1, y1), (x2, y2)):
            d.ellipse([x * S - r, y * S - r, x * S + r, y * S + r], fill=c)
    def tri(pts, c):
        d.polygon([(x * S, y * S) for x, y in pts], fill=c)
    line(13, 23, 42, 23, "#89b4fa"); tri([(38, 12), (54, 23), (38, 34)], "#89b4fa")
    line(51, 41, 22, 41, "#a6e3a1"); tri([(26, 30), (10, 41), (26, 52)], "#a6e3a1")
    return img.resize((px, px), Image.LANCZOS)

# Menu-bar / tray icon: arrows only, 44px for Retina menu bars
render(44, tile=False).save(os.path.join(ROOT, "src/main/resources/static/tray-icon.png"))

# macOS app icon: Apple's grid leaves ~10% margin around the rounded tile
with tempfile.TemporaryDirectory() as tmp:
    iconset = os.path.join(tmp, "Reqly.iconset")
    os.makedirs(iconset)
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            px = size * scale
            canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
            inner = round(px * 0.82)
            canvas.paste(render(inner), ((px - inner) // 2, (px - inner) // 2))
            canvas.save(os.path.join(iconset, f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(ROOT, "packaging/macos/Reqly.icns")], check=True)
print("icons written")
