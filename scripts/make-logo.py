#!/usr/bin/env python3
"""Draws the Kural logo, {K} on a purple rounded square, into every file that needs it:
  assets/icon.png              app icon (1024x1024; the builds make .icns / .ico from it)
  assets/media/*.svg           title bar, About, and the faint logo in an empty editor
Run after changing the logo:  python3 scripts/make-logo.py   (icon.png needs: pip install cairosvg)
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "assets", "media")

# { K } drawn with strokes on a 100x100 canvas.
GLYPHS = ('<path d="M33 27c-7 0-8 5-8 10v5c0 4-2 7-6 8 4 1 6 4 6 8v5c0 5 1 10 8 10" fill="none" stroke="{c}"{o} stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'
          '<path d="M67 27c7 0 8 5 8 10v5c0 4 2 7 6 8-4 1-6 4-6 8v5c0 5-1 10-8 10" fill="none" stroke="{c}"{o} stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'
          '<path d="M43 37v26M58 37L44 50l14 13" fill="none" stroke="{c}"{o} stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>')


def glyphs(color, opacity=None):
    return GLYPHS.format(c=color, o=f' stroke-opacity="{opacity}"' if opacity else "")


def color_logo(size=1024):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 100 100">'
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b49cff"/>'
            '<stop offset="1" stop-color="#6d4fe0"/></linearGradient></defs>'
            '<rect x="4" y="4" width="92" height="92" rx="22" fill="url(#g)"/>' + glyphs("#ffffff") + '</svg>')


def flat_logo(shape, shape_opacity, glyph, glyph_opacity=None):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 100 100">'
            f'<rect x="4" y="4" width="92" height="92" rx="22" fill="{shape}" fill-opacity="{shape_opacity}"/>'
            + glyphs(glyph, glyph_opacity) + '</svg>')


FILES = {
    "code-icon.svg": color_logo(),
    "vscode-icon.svg": color_logo(),
    "letterpress-dark.svg": flat_logo("#ffffff", ".07", "#ffffff", ".16"),
    "letterpress-light.svg": flat_logo("#000000", ".07", "#000000", ".22"),
    "letterpress-hcDark.svg": flat_logo("#ffffff", ".25", "#000000"),
    "letterpress-hcLight.svg": flat_logo("#000000", ".2", "#ffffff"),
}

if __name__ == "__main__":
    os.makedirs(MEDIA, exist_ok=True)
    for name, svg in FILES.items():
        with open(os.path.join(MEDIA, name), "w") as f:
            f.write(svg)
    try:
        import cairosvg
        cairosvg.svg2png(bytestring=color_logo().encode(), write_to=os.path.join(ROOT, "assets", "icon.png"),
                         output_width=1024, output_height=1024)
        print("wrote assets/icon.png and assets/media/*.svg")
    except ImportError:
        print("wrote assets/media/*.svg (install cairosvg to also redraw assets/icon.png)")
