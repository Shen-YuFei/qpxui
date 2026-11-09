#!/usr/bin/env python3
"""Generate the QPX app icon programmatically (no external backend).

Draws a rounded-corner tile with a cyan->indigo gradient, a faint data grid,
and a connected peptide-sequence sparkline motif. Output: icon-source.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
R = 200  # corner radius

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# --- rounded-corner mask ---
mask = Image.new("L", (SIZE, SIZE), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=R, fill=255)

# --- vertical gradient tile (cyan -> indigo) ---
top = (34, 211, 238)    # #22d3ee
bot = (99, 102, 241)    # #6366f1
grad = Image.new("RGBA", (SIZE, SIZE))
gd = ImageDraw.Draw(grad)
for y in range(SIZE):
    t = y / (SIZE - 1)
    c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    gd.line([(0, y), (SIZE, y)], fill=c + (255,))

# inner soft glow (lighter toward center-top)
shine = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shine)
sd.ellipse([-200, -300, SIZE + 200, SIZE * 0.6], fill=(255, 255, 255, 60))
shine = shine.filter(ImageFilter.GaussianBlur(120))
grad = Image.alpha_composite(grad, shine)

img = Image.composite(grad, img, mask)

# --- faint data grid ---
grid = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
grd = ImageDraw.Draw(grid)
step = 128
for gx in range(0, SIZE, step):
    grd.line([(gx, 0), (gx, SIZE)], fill=(255, 255, 255, 22), width=2)
for gy in range(0, SIZE, step):
    grd.line([(0, gy), (SIZE, gy)], fill=(255, 255, 255, 22), width=2)
grid = grid.filter(ImageFilter.GaussianBlur(1))
img = Image.alpha_composite(img, grid)

# --- peptide sparkline motif ---
# nodes sit on a gentle biological curve
pts = [
    (190, 470),
    (320, 380),
    (450, 430),
    (580, 320),
    (710, 380),
    (840, 270),
]
fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
fd = ImageDraw.Draw(fg)

# connecting line
fd.line(pts, fill=(255, 255, 255, 235), width=26, joint="curve")
# quantitative bar chart along the bottom: one bar under each node
baseline = 840
bar_w = 70
heights = [150, 230, 190, 280, 210, 320]
for (x, _), h in zip(pts, heights):
    fd.rounded_rectangle([x - bar_w // 2, baseline - h, x + bar_w // 2, baseline],
                         radius=14, fill=(255, 255, 255, 120))
fd.rounded_rectangle([140, baseline + 6, 890, baseline + 22], radius=8,
                     fill=(255, 255, 255, 200))

img = Image.alpha_composite(img, fg)

# --- overlay white node discs ---
disc = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
dd = ImageDraw.Draw(disc)
for (x, y) in pts:
    dd.ellipse([x - 50, y - 50, x + 50, y + 50], fill=(255, 255, 255, 255))
img = Image.alpha_composite(img, disc)

# re-apply the mask to keep corners transparent
final = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
final.paste(img, (0, 0), mask)

out = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "icon-source.png"
final.save(out)
print("wrote", out)
