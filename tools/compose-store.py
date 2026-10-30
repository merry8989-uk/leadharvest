#!/usr/bin/env python3
"""Turns the raw renders into store-ready assets: 1280x800 screenshots + a popup slide."""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAW = 'store/raw'
OUT = 'store'
TARGET = (1280, 800)
FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_REG = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def rounded(img, radius):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def shadow(canvas, box, radius, blur=28, alpha=70):
    layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, fill=(15, 23, 42, alpha))
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def plain(name, src, dst):
    img = Image.open(os.path.join(RAW, src)).convert('RGB')
    img = img.resize(TARGET, Image.LANCZOS)
    path = os.path.join(OUT, dst)
    img.save(path, optimize=True)
    print('%-26s %dx%d  %d KB' % (dst, img.width, img.height, os.path.getsize(path) // 1024))


def popup_slide():
    canvas = Image.new('RGBA', TARGET, (246, 247, 251, 255))
    # soft brand glow
    glow = Image.new('RGBA', TARGET, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([TARGET[0] * 0.18, -TARGET[1] * 0.55, TARGET[0] * 1.05, TARGET[1] * 0.95], fill=(79, 70, 229, 46))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))

    shot = Image.open(os.path.join(RAW, 'store-popup.png')).convert('RGBA')
    target_h = 600
    scale = target_h / shot.height
    shot = shot.resize((int(shot.width * scale), target_h), Image.LANCZOS)
    shot = rounded(shot, 26)

    x = (TARGET[0] - shot.width) // 2
    y = 62
    shadow(canvas, [x + 6, y + 14, x + shot.width + 6, y + shot.height + 14], 26)
    canvas.alpha_composite(shot, (x, y))

    d = ImageDraw.Draw(canvas)
    title = ImageFont.truetype(FONT_BOLD, 30)
    sub = ImageFont.truetype(FONT_REG, 20)
    t1 = 'One tap to scrape the page you are on'
    t2 = 'Contact page, team page, listing or directory — the extractor reads it and stores it locally.'
    w1 = d.textlength(t1, font=title)
    w2 = d.textlength(t2, font=sub)
    ty = y + shot.height + 34
    d.text(((TARGET[0] - w1) / 2, ty), t1, font=title, fill=(15, 23, 42, 255))
    d.text(((TARGET[0] - w2) / 2, ty + 44), t2, font=sub, fill=(100, 116, 139, 255))

    path = os.path.join(OUT, 'shot-5-popup.png')
    canvas.convert('RGB').save(path, optimize=True)
    print('%-26s %dx%d  %d KB' % ('shot-5-popup.png', TARGET[0], TARGET[1], os.path.getsize(path) // 1024))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    plain('data', 'store-data.png', 'shot-1-data.png')
    plain('structure', 'store-schema.png', 'shot-2-structure.png')
    plain('diagnostics', 'store-diagnostics.png', 'shot-3-diagnostics.png')
    plain('history', 'store-history.png', 'shot-4-history.png')
    popup_slide()
