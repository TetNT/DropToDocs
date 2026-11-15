"""Draws the DropToDocs icon and writes icons/icon{16,32,48,128}.png.

Run from the repo root:  python tools/make_icons.py

Everything is drawn at 1024 px and scaled down, so edges stay smooth.
The 16 px toolbar size uses a simpler drawing (no drop line) so it stays legible.
"""
from pathlib import Path
from PIL import Image, ImageDraw

HI = 1024  # working resolution of the artwork box
TOP = (139, 92, 246)     # violet  #8B5CF6
BOTTOM = (79, 70, 229)   # indigo  #4F46E5
ARROW = (79, 70, 229)
PAPER = (255, 255, 255)
FOLD = (221, 214, 254)   # #DDD6FE

# Canvas size -> artwork box size. Chrome asks for 96x96 art with 16 px of
# transparent padding in the 128 icon; toolbar sizes use nearly the full square.
SIZES = {128: 96, 48: 40, 32: 30, 16: 16}


def artwork(simple: bool) -> Image.Image:
    s = HI
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))

    # Rounded square with a vertical violet -> indigo gradient.
    grad = Image.new('RGBA', (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / (s - 1)
        gd.line([(0, y), (s, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.23), fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # Document with a folded top-right corner.
    w, h = s * (0.56 if simple else 0.50), s * (0.66 if simple else 0.62)
    x0, y0 = (s - w) / 2, (s - h) / 2 + s * 0.01
    x1, y1 = x0 + w, y0 + h
    f = w * 0.30
    d.polygon([(x0, y0), (x1 - f, y0), (x1, y0 + f), (x1, y1), (x0, y1)], fill=PAPER)
    d.polygon([(x1 - f, y0), (x1 - f, y0 + f), (x1, y0 + f)], fill=FOLD)

    # Down arrow dropping into the page, plus a short "landing" line under it.
    cx = (x0 + x1) / 2 - (0 if simple else w * 0.03)
    shaft_w = w * (0.24 if simple else 0.18)
    head_w = w * (0.66 if simple else 0.54)
    top = y0 + h * (0.16 if simple else 0.17)
    tip = y1 - h * (0.16 if simple else 0.30)
    head_h = head_w * 0.55
    d.rectangle([cx - shaft_w / 2, top, cx + shaft_w / 2, tip - head_h + 2], fill=ARROW)
    d.polygon([(cx - head_w / 2, tip - head_h), (cx + head_w / 2, tip - head_h), (cx, tip)], fill=ARROW)
    if not simple:
        lw = h * 0.065
        ly = y1 - h * 0.17
        d.rounded_rectangle([cx - head_w / 2, ly, cx + head_w / 2, ly + lw], radius=lw / 2, fill=ARROW)

    return img


def main() -> None:
    out = Path(__file__).resolve().parent.parent / 'icons'
    out.mkdir(exist_ok=True)
    full, simple = artwork(simple=False), artwork(simple=True)
    for size, art in SIZES.items():
        canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        src = simple if size <= 16 else full
        scaled = src.resize((art, art), Image.LANCZOS)
        off = (size - art) // 2
        canvas.paste(scaled, (off, off), scaled)
        canvas.save(out / f'icon{size}.png', optimize=True)
        print('wrote', out / f'icon{size}.png')


if __name__ == '__main__':
    main()
