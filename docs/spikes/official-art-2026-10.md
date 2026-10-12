# Spike: official Secret Hitler art (todo #193)

## Question

Can we replace our redrawn cards, boards and placards with the real Secret Hitler art, credited, so the game looks like a polished official edition? Which source, which components, and what is the plan?

User decisions taken during the spike:
- In-world objects (cards, ballots, role and membership cards, boards, placards) use the official art.
- The HUD chrome stays dark glass but shows the real card images.
- The 3D patrons stay human. Lizards appear only on cards and the game-over screen.

## What I verified

### Licence

- secrethitler.com says the game is free under Creative Commons BY-NC-SA 4.0: credit it, don't profit, share alike, no app stores.
- This project is already CC-BY-NC-SA-4.0 (package.json, LICENSE), non-commercial and web-only, so using the art is allowed with credit.
- Credit chain: Secret Hitler © 2016 Goat, Wolf & Cabbage (Mike Boxleiter, Tommy Maranges, Max Temkin), art by Mackenzie Schubert. Adapted from FragaholiC's Tabletop Simulator port (https://steamcommunity.com/sharedfiles/filedetails/?id=584715565). Colour print-and-play remake © 2019 Lee Yingtong Li (https://yingtongli.me/blog/2019/12/25/secret-hitler.html). All CC BY-NC-SA 4.0.

### Sources

Downloaded to `C:\Users\Tiago\code\pov-assets-src\official\` (outside git), rasterised with PyMuPDF and inspected.

| File | URL | Size | Verdict |
| --- | --- | --- | --- |
| `official_pnp.pdf` | https://www.secrethitler.com/assets/Secret_Hitler_Print_and_Play.pdf | 3.66 MB, 13 pages | Official, but greyscale scans (one 3300x2550 grey image per page). Not used. |
| `official_rules.pdf` | https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf | 1.48 MB | Reference only |
| `remake_pnp.pdf` | https://www.yingtongli.me/blog/assets/posts/2019/SecretHitler/PnP.pdf | 10.4 MB, 20 pages | **Chosen.** Full colour, retail look, vector with embedded fonts (Germania, Futura, Eskapade); the role art is raster at 735x1024. |
| `svg/*.svg` (23 files) | https://yingtongli.me/blog/assets/posts/2019/SecretHitler/svg/ | 12.6 MB | Same art as the PDF, but the text needs fonts we don't have (Futura, Germania, Eskapade Fraktur). Use the PDF instead. |

Tooling: PyMuPDF is installed (`python -c "import fitz"`). Rendering the remake PDF at 100-150 dpi gave crisp text and clean flat colours, with no font substitution.

### Component inventory (remake_pnp.pdf, 0-based page index)

| Component | Page | Notes |
| --- | --- | --- |
| Logo and credits | 0 | Vector "SECRET HITLER" block logo with the CC credit line |
| Policy faces | 1 | Fascist (red skull "FASCIST ARTICLE"), rows 1-2; liberal (blue bird "LIBERAL ARTICLE"), row 3. "High contrast" white-face variant. |
| Policy back | 2 | Dark "POLICY" card |
| President / Chancellor placards | 3 | Colour, but printed upside down for folding: rotate 180°. The page also carries the rules-reminder panels. |
| Ballot Ja! | 4 | |
| Ballot back | 5 (and 7) | Green "BALLOT" envelope art |
| Ballot Nein | 6 | |
| Secret role fronts | 8 | Embedded raster, 735x1024 each. Exactly **one** liberal, one fascist and one Hitler image; the retail game's 6 liberal and 3 fascist portrait variants are not in either source checked. |
| Secret role back | 9 | Embedded raster, "SECRET ROLE" banner |
| Party membership fronts | 10 | Liberal (raster) and fascist, yellow card with party seal |
| Party membership back | 11 | |
| Liberal board + draw/discard pile cards | 12 | 5 slots, dove WIN slot, election tracker with 3 FAIL steps; inside a dark bleed frame with crop marks |
| Liberal board back | 13 | Not needed |
| Fascist board, 5-6 players | 14 | Slot 3 peek, 4-5 execute (5 unlocks veto), 6 skull |
| Fascist board, 7-8 players | 16 | 2 investigate, 3 special election, 4-5 execute |
| Fascist board, 9-10 players | 18 | 1-2 investigate, 3 special election, 4-5 execute |
| Fascist board back | 15, 17, 19 | Not needed |

Card grid on the card pages: card rectangles about 181x253 pt, in columns starting at x = 34, 269, 505, 740, 975 and rows at y = 140, 449 (role pages). The pipeline should trim each card to its own rectangle (find it from the embedded image rects, or by trimming the bleed) rather than trusting these numbers.

Missing from both sources: an envelope, the election tracker token and portrait variants. We keep our own envelope and tracker marker.

### Code it plugs into

- `client/scene/textures.ts`: `tex(key,w,h,draw)` (:67) caches CanvasTextures, and `redrawTextures()` (:98) repaints them. The official images draw into the same canvases, so the meshes, cache and draw calls are unchanged. The procedural draws stay as the fallback.
- The card functions are policyFace (:460), cardBack (:475), ballotFace (:507), roleCard (:541), membershipCard (:564) and placardTexture (:724). boardTexture (:885) owns `BOARD_SLOTS` (:986), which the 3D markers use.
- `client/art.ts` serves the HUD images (game-over portraits, role chip seal, enact banner seal) as canvas data: URLs today.
- CSP: `img-src 'self' data: blob:`, `connect-src 'self'`. vite never inlines webp, so official art ships as hashed files under a new `client/art/` with its own budget (≤2.5 MB), separate from the 4 MB `client/models` budget.

## Options

1. **Colour remake rasterised from its PnP.pdf (recommended).** It is the only complete colour set. It is close to the retail look, has embedded fonts and the same licence.
2. Official secrethitler.com print-and-play. Authoritative but greyscale, so it would look worse than our current redraws.
3. Keep redrawing (the current "Schubert on dark"). Rejected by the user: they want the real assets.
4. Scraping retail or Tabletop Simulator images directly. Licence unclear on the Workshop page. Not needed.

## Risks and open questions

- The white-faced policy cards and cream placards are bright on the dark table (#170 called the old UI "too white"). Card brightness can be toned with the material colour if the human objects.
- The official boards' slot geometry differs from ours, so `BOARD_SLOTS` must be re-measured and the 3D markers re-checked live.
- Only one portrait per role means the table's role cards are identical. That matches the print-and-play but loses our seeded variety.
- The art direction guide (`docs/design/art-direction.md`, DECISIONS #24) says "never copy Schubert's artwork". It is rewritten in FLT-0006 #201.

## Follow-up tracking

Task **FLT-0006 "Official art"** (branch `official-art`), in dependency order:

1. #195 Art pipeline and credits: `scripts/official-art.py`, webp under `client/art/`, `client/art/CREDITS.md`, README credit, a budget test.
2. #196 Art loader (`client/scene/officialart.ts`) with the procedural fallback and `?art=old`. Needs #195.
3. #197 Cards use the official art. Needs #196.
4. #198 Official boards and re-measured `BOARD_SLOTS`. Needs #196.
5. #199 Placards and the HUD logo. Needs #196.
6. #200 HUD shows the real card images (art.ts). Needs #197.
7. #201 Art direction rewrite and DECISIONS entry. Needs #197-#200.
8. #202 Retire the redraws, after the human approves the look live. Needs #201.
