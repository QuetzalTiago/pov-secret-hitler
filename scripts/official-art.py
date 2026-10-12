"""Extract the official Secret Hitler art from Lee Yingtong Li's colour print-and-play PDF.

Writes trimmed webp files to client/art/. See scripts/official-art.md for how to run it and
client/art/CREDITS.md for the licence.

    python -I scripts/official-art.py [--src PnP.pdf] [--out client/art]

Outputs (page numbers are 0-based PDF page indexes):

| name                | page | how                                                                  |
|---------------------|------|----------------------------------------------------------------------|
| policy-F            | 1    | render first cut rect (fascist row), 512x720                         |
| policy-L            | 1    | render last cut rect (liberal row), 512x720                          |
| policy-back         | 2    | render first cut rect, 512x720                                       |
| ballot-ja           | 4    | render first cut rect, rotated upright, 512x720                      |
| ballot-back         | 5    | render first cut rect, 512x720                                       |
| ballot-nein         | 6    | render first cut rect, rotated upright, 512x720                      |
| role-liberal        | 8    | embedded raster at the top-left slot, trimmed to the card, 512x720   |
| role-fascist        | 8    | embedded raster at row 2, column 2, trimmed to the card, 512x720     |
| role-hitler         | 8    | embedded raster at row 2, column 5, trimmed to the card, 512x720     |
| role-back           | 9    | embedded raster, trimmed to the card, 512x720                        |
| member-liberal      | 10   | embedded raster, cropped to the cut rect, 512x720                    |
| member-fascist      | 10   | render the row 2, column 2 cut rect, 512x720                         |
| member-back         | 11   | render first cut rect, 512x720                                       |
| placard-president   | 3    | render the placard, rotated 180 degrees, <= 1024 px wide             |
| placard-chancellor  | 3    | render the placard, rotated 180 degrees, <= 1024 px wide             |
| board-liberal       | 12   | render the board cut rect, dark frame trimmed, <= 2048 px wide       |
| board-fascist-56    | 14   | same                                                                 |
| board-fascist-78    | 16   | same                                                                 |
| board-fascist-910   | 18   | same                                                                 |
| logo                | 0    | render the logo on a transparent background, <= 1024 px wide         |

A "cut rect" is the white (or coloured) rectangle the PDF draws inside each card's bleed area, the line
you cut along. Rects are found from the page's vector drawings, not hard-coded coordinates.
"""

import argparse
import io
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = Path(r"C:\Users\Tiago\code\pov-assets-src\official\remake_pnp.pdf")
DEFAULT_OUT = ROOT / "client" / "art"

CARD = (512, 720)
CARD_QUALITY = 82
BOARD_QUALITY = 80
BUDGET = int(2.5 * 1024 * 1024)

SMALL_CUT = (127.5, 178.6)  # policy cards, pt
LARGE_CUT = (178.6, 252.3)  # ballots, roles, membership cards, pt
BOARD_FRAME = (54, 56, 53)  # dark bleed colour around the boards


def drawing_rects(page, size, tol=1.0):
    """Filled drawing rects of roughly the given size, in reading order (row, then column)."""
    found = {}
    for d in page.get_drawings():
        r = d["rect"]
        if d.get("fill") is not None and abs(r.width - size[0]) < tol and abs(r.height - size[1]) < tol:
            found[(round(r.y0), round(r.x0))] = r
    return [found[k] for k in sorted(found)]


def render(page, rect, zoom, alpha=False):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=rect, alpha=alpha)
    return Image.frombytes("RGBA" if alpha else "RGB", (pix.width, pix.height), pix.samples)


def render_cut(page, rect, rotate=0):
    """Render a card's cut rect (inset a hair so anti-aliasing never picks up a neighbour)."""
    img = render(page, pymupdf.Rect(rect) + (0.3, 0.3, -0.3, -0.3), 4.5)
    if rotate:
        img = img.rotate(rotate, expand=True)
    return img.resize(CARD, Image.LANCZOS)


def embedded(doc, page, pick):
    """The embedded raster placed at the slot chosen by pick(bbox); returns (image, bbox)."""
    placed = [i for i in page.get_image_info(xrefs=True) if i["xref"]]
    info = min(placed, key=lambda i: pick(pymupdf.Rect(i["bbox"])))
    data = doc.extract_image(info["xref"])["image"]
    return Image.open(io.BytesIO(data)).convert("RGB"), pymupdf.Rect(info["bbox"])


def trim_to_card(img, inset=0.012):
    """Crop a role raster to its coloured, rounded card (the raster carries a white margin)."""
    px = img.convert("L").point(lambda v: 255 if v < 235 else 0)
    x0, y0, x1, y1 = px.getbbox()
    dx, dy = round((x1 - x0) * inset), round((y1 - y0) * inset)
    return img.crop((x0 + dx, y0 + dy, x1 - dx, y1 - dy)).resize(CARD, Image.LANCZOS)


def trim_to_rect(img, bbox, cut):
    """Crop a full-bleed raster placed at bbox down to the cut rect inside it."""
    sx, sy = img.width / bbox.width, img.height / bbox.height
    box = ((cut.x0 - bbox.x0) * sx, (cut.y0 - bbox.y0) * sy, (cut.x1 - bbox.x0) * sx, (cut.y1 - bbox.y0) * sy)
    return img.crop(tuple(round(v) for v in box)).resize(CARD, Image.LANCZOS)


def fit_width(img, max_w):
    if img.width <= max_w:
        return img
    return img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)


def board(page, max_w=2048):
    """The board art: its cut rect with the dark bleed frame trimmed off."""
    cut = drawing_rects(page, (1114.1, 396.9), tol=1.5)[0]
    img = render(page, cut, 1.9)
    gap = ImageChops.difference(img, Image.new("RGB", img.size, BOARD_FRAME)).convert("L")
    box = gap.point(lambda v: 255 if v > 25 else 0).getbbox()
    return fit_width(img.crop(box), max_w)


def placard(page, rect):
    """Render a placard rotated upright, with the white page around its outline made transparent."""
    img = render(page, pymupdf.Rect(rect), 2.2).convert("RGBA").rotate(180, expand=True)
    w, h = img.size
    edge = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    for xy in edge:
        if min(img.getpixel(xy)[:3]) > 240:
            ImageDraw.floodfill(img, xy, (255, 255, 255, 0), thresh=40)
    return fit_width(img, 1024)


def logo(page):
    img = render(page, pymupdf.Rect(230, 70, 600, 340), 4, alpha=True)
    return fit_width(img.crop(img.getchannel("A").getbbox()), 1024)


def build(doc):
    """Return {name: (image, webp quality)}."""
    out = {}
    p = doc.load_page
    small = {n: drawing_rects(p(n), SMALL_CUT) for n in (1, 2)}
    large = {n: drawing_rects(p(n), LARGE_CUT) for n in (4, 5, 6, 10, 11)}

    out["policy-F"] = render_cut(p(1), small[1][0])
    out["policy-L"] = render_cut(p(1), small[1][-1])
    out["policy-back"] = render_cut(p(2), small[2][0])
    out["ballot-ja"] = render_cut(p(4), large[4][0], rotate=90)
    out["ballot-back"] = render_cut(p(5), large[5][0])
    out["ballot-nein"] = render_cut(p(6), large[6][0], rotate=90)

    top_left = lambda r: r.x0 + r.y0
    for name, pick in (
        ("role-liberal", top_left),
        ("role-fascist", lambda r: abs(r.x0 - 269) + abs(r.y0 - 449)),
        ("role-hitler", lambda r: abs(r.x0 - 975) + abs(r.y0 - 449)),
    ):
        out[name] = trim_to_card(embedded(doc, p(8), pick)[0])
    out["role-back"] = trim_to_card(embedded(doc, p(9), top_left)[0])

    img, bbox = embedded(doc, p(10), top_left)
    out["member-liberal"] = trim_to_rect(img, bbox, large[10][0])
    out["member-fascist"] = render_cut(p(10), large[10][6])
    out["member-back"] = render_cut(p(11), large[11][0])

    # Placard art is printed upside down so it reads right when folded; the 1.3 pt margin is the stroke.
    out["placard-president"] = placard(p(3), (58.6, 93.6, 536.7, 221.5))
    out["placard-chancellor"] = placard(p(3), (61.3, 479.5, 534.3, 601.5))

    for name, n in (("liberal", 12), ("fascist-56", 14), ("fascist-78", 16), ("fascist-910", 18)):
        out[f"board-{name}"] = board(p(n))
    out["logo"] = logo(p(0))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC, help="remake_pnp.pdf (default: %(default)s)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output directory (default: %(default)s)")
    args = ap.parse_args()
    if not args.src.is_file():
        sys.exit(f"source PDF not found: {args.src} (see scripts/official-art.md)")

    args.out.mkdir(parents=True, exist_ok=True)
    total = 0
    with pymupdf.open(args.src) as doc:
        for name, img in build(doc).items():
            path = args.out / f"{name}.webp"
            quality = BOARD_QUALITY if name.startswith("board-") else CARD_QUALITY
            img.save(path, "WEBP", quality=quality, method=6)
            size = path.stat().st_size
            total += size
            print(f"{path.name:24} {img.width:5}x{img.height:<5} {size:8} bytes")
    print(f"total {total} bytes ({total / 1024 / 1024:.2f} MB, budget {BUDGET / 1024 / 1024:.1f} MB)")
    if total > BUDGET:
        sys.exit("over budget: lower the webp quality")


if __name__ == "__main__":
    main()
