#!/usr/bin/env python3
"""Makes the app icons from assets/icon.png: icon.icns (macOS) and icon.ico (Windows).
With Pillow (Ubuntu: python3-pil) both; on a Mac without Pillow, macOS's own sips and iconutil make icon.icns, the only
one the Mac build needs (the Windows build runs on Linux). So building on a Mac installs nothing (an older Pillow pinned
for macOS's Python 3.9 had published advisories).
Usage: make-icons.py <out-dir>"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "icon.png")   # 1024 x 1024
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

try:
    from PIL import Image
except ImportError:
    Image = None

if Image is not None:
    img = Image.open(SRC).convert("RGBA")
    big = img.resize((1024, 1024), Image.LANCZOS)
    big.save(os.path.join(out, "icon.icns"))
    img.save(os.path.join(out, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("icons written to", out)
elif sys.platform == "darwin" and shutil.which("sips") and shutil.which("iconutil"):
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "icon.iconset")
        os.makedirs(iconset)
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                px = str(size * scale)
                name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
                subprocess.run(["sips", "-z", px, px, SRC, "--out", os.path.join(iconset, name)], check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(out, "icon.icns")], check=True)
    print("icon.icns written to", out, "(with sips and iconutil; icon.ico needs Pillow)")
else:
    sys.exit("make-icons.py needs Pillow (Ubuntu: sudo apt install python3-pil), or on a Mac, sips and iconutil")
