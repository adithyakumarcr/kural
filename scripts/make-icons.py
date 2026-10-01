#!/usr/bin/env python3
"""Makes the app icons from assets/icon.png: icon.icns (macOS) and icon.ico (Windows).
Usage: make-icons.py <out-dir>"""
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
img = Image.open(os.path.join(ROOT, "assets", "icon.png")).convert("RGBA")
big = img.resize((1024, 1024), Image.LANCZOS)
big.save(os.path.join(out, "icon.icns"))
img.save(os.path.join(out, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icons written to", out)
