# Reproducing `client/art/`

The art is cropped out of Lee Yingtong Li's colour print-and-play remake of Secret Hitler by `scripts/official-art.py`. The PDF is not in git. Download it once and put it outside the repo:

```sh
mkdir -p /c/Users/Tiago/code/pov-assets-src/official
curl -sL https://www.yingtongli.me/blog/assets/posts/2019/SecretHitler/PnP.pdf -o /c/Users/Tiago/code/pov-assets-src/official/remake_pnp.pdf
```

Needs Python 3.11 with `pymupdf` (import name `pymupdf`, not `fitz`) and `pillow` with webp support (`pip install pymupdf pillow`). Always run it in isolated mode, from the repo root:

```sh
python -I scripts/official-art.py
# or: python -I scripts/official-art.py --src <pdf> --out <dir>
```

It rewrites every file below (deterministic) and prints each one with its size and the total.

## Outputs (`client/art/`)

| Files | Size |
|---|---|
| `policy-L`, `policy-F`, `policy-back`, `ballot-ja`, `ballot-nein`, `ballot-back`, `role-liberal`, `role-fascist`, `role-hitler`, `role-back`, `member-liberal`, `member-fascist`, `member-back` (all `.webp`) | 512x720 |
| `placard-president`, `placard-chancellor` | 1024 px wide, transparent outside the outline, rotated upright (the PDF prints them upside down) |
| `board-liberal`, `board-fascist-56`, `board-fascist-78`, `board-fascist-910` | about 2000 px wide, dark bleed frame and crop marks trimmed |
| `logo` | 1024 px wide, transparent background |

The table at the top of the script lists the source page and method for each file. Role and membership fronts and the role back are embedded rasters in the PDF and are extracted, not re-rendered. Everything else is rendered from the page's vector drawings, cropped to rects found from those drawings.

Budget: all `client/art/*.webp` together must stay under 2.5 MB (currently about 0.75 MB). The script exits non-zero if it goes over. `tests/art-files.test.ts` guards the file list, the webp headers and dimensions, the budget and the credits file.

Licence and credits: `client/art/CREDITS.md` (CC BY-NC-SA 4.0). Background: `docs/spikes/official-art-2026-10.md`.
