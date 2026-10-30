#!/usr/bin/env python3
"""Renders the LeadHarvest icon at any size from one vector-ish definition.
Usage: python3 tools/make-icon.py --out store --sizes 16,32,48,128,256,512"""
import argparse, os
from PIL import Image, ImageDraw, ImageFilter

BRAND_TOP = (79, 70, 229)     # indigo 600
BRAND_BOTTOM = (124, 58, 237)  # violet 600

def render(size, supersample=8):
    S = size * supersample
    # diagonal gradient
    grad = Image.new('RGB', (S, S))
    px = grad.load()
    for y in range(S):
        for x in range(0, S, max(1, S // 256)):
            t = (x / S * 0.45 + y / S * 0.55)
            r = int(BRAND_TOP[0] + (BRAND_BOTTOM[0] - BRAND_TOP[0]) * t)
            g = int(BRAND_TOP[1] + (BRAND_BOTTOM[1] - BRAND_TOP[1]) * t)
            b = int(BRAND_TOP[2] + (BRAND_BOTTOM[2] - BRAND_TOP[2]) * t)
            for dx in range(max(1, S // 256)):
                if x + dx < S:
                    px[x + dx, y] = (r, g, b)

    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.235), fill=255)

    icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    icon.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(icon)

    # soft top highlight so the tile does not look flat
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse([-S * 0.25, -S * 0.75, S * 1.25, S * 0.42], fill=(255, 255, 255, 34))
    icon = Image.alpha_composite(icon, hl)
    icon.putalpha(Image.composite(icon.split()[3], Image.new('L', (S, S), 0), mask))
    d = ImageDraw.Draw(icon)

    # funnel
    pts = [
        (0.195 * S, 0.245 * S), (0.805 * S, 0.245 * S),
        (0.585 * S, 0.525 * S), (0.585 * S, 0.700 * S),
        (0.415 * S, 0.775 * S), (0.415 * S, 0.525 * S),
    ]
    d.polygon(pts, fill=(255, 255, 255, 255))
    # the record that fell through
    r = 0.052 * S
    cx, cy = 0.685 * S, 0.665 * S
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 210))

    return icon.resize((size, size), Image.LANCZOS)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='store')
    ap.add_argument('--sizes', default='16,32,48,128,256,512')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for s in [int(x) for x in a.sizes.split(',')]:
        img = render(s)
        path = os.path.join(a.out, 'icon-%d.png' % s)
        img.save(path)
        print('%-28s %d×%d  %d B' % (path, img.width, img.height, os.path.getsize(path)))

if __name__ == '__main__':
    main()
