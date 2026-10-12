# Art direction: Schubert on dark

Rule of thumb: every card, seal, portrait, sign and board element is drawn in his flat, blocky, photograph-like
graphic language, in our dark palette. When in doubt, flatter, blockier, darker.

## Source

Mackenzie Schubert, "Secret Hitler illustration & graphic design" (Medium, Dec 2015):
https://medium.com/@mackenzieschubert/secret-hitler-illustration-graphic-design-435be3e3586c

What he did, and what we take from it:

- Flat inks, no gradation. The final portraits use "neither gradation or color": solid shapes and a few inks.
- Simple, blocky typography, with the portraits drawn to match its weight and angularity.
- One ornate seal per party. Each started as a simple icon that had to reduce cleanly, then gained ornament.
- Policy-track borders were simplified from the ornate borders of period documents, then replaced or joined by
  iconography that tells the liberal and fascist tracks apart.
- The election tracker was merged into the liberal board instead of living as a separate piece.
- Fascists are lizards in suits; liberals are 1930s humans.
- Portraits read like photographs, not paintings (silhouette and contrast carry them).
- Human masks on the lizards were rejected: they hurt at-a-glance recognition.
- The envelope and the secret "X" are the identity motif.

We take the principles. We never trace, copy or closely imitate his artwork.

## Our adaptation

"Schubert on dark": his graphic language on our dark glass HUD, leather board and dark card stock.

- Lizards are 2D only: role cards, role reveal, game over.
- 3D patrons stay human at the bar, because they hide their roles.
- The UI stays dark. Parchment fills only `#prompt.mine` and `#confirm-card`.

## Palette

Large fills must have WCAG relative luminance <= 0.45 (pinned by `tests/textures-palette.test.ts`).

| Role | Hex | Use |
| --- | --- | --- |
| ink | `#14110f` | outlines, black ink |
| line (cream) | `#e8d6b0` | strokes, rules and lettering ONLY, never a large fill |
| liberal | `#3d6a86` | slate blue, liberal fills |
| liberalDeep | `#22394a` | liberal shadow ink, track backgrounds |
| fascist | `#b5482f` | brick red, fascist fills |
| fascistDeep | `#5e2016` | fascist shadow ink, track backgrounds |
| hitler | `#7a1a10` | Hitler role only |
| brass | `#b8913f` | rules and frames |
| card stock | `#b9a37c` | paper and card stock, unchanged |
| background | `#0b0807` | page and scene dark |

- Each illustration uses 2-3 inks plus the ink outline. No more.
- Cream is for thin things. If a shape is large, it is not cream.
- Brass is a rule or a frame, never a surface.

## Type roles

| Role | Face | Use |
| --- | --- | --- |
| Block display | `--font-block`, Big Shoulders Display 800 | headings, logo, ballots, card titles |
| UI display | Jost | UI display text |
| Body / UI | Courier Prime | body text and UI |
| Paperwork | Special Elite (typewriter) | period paperwork |
| Blackletter | UnifrakturMaguntia | in-world period signage and posters ONLY |

- Never set game-critical text (votes, roles, prompts, counts) in blackletter.
- All fonts are self-hosted under `client/fonts`. The CSP is `default-src 'self'`, so no font CDNs.

## Seals

- Round, with a stepped art-deco rim.
- Ring lettering: "LIBERAL PARTY" / "FASCIST PARTY".
- Centre: the existing liberal bird / fascist skull emblem.
- Flat fills with a thick ink outline. It must reduce to a recognisable icon at small sizes first, ornament second.

## Borders and board

- Liberal track: wave or laurel band.
- Fascist track: stepped key band.
- Slots carry iconography in flat ink: seal miniatures and power icons.
- The election tracker belongs on the liberal board, not as a separate object.
- Borders are simplified period-document borders: few steps, thick strokes, no hairline filigree.

## Portraits

- Flat, blocky busts with photograph-like silhouettes. 2-3 inks, no gradients.
- Fascists: lizards in suits and hats.
- Hitler: a lizard with a distinct peaked cap, in `hitler` red.
- Liberals: 1930s humans in a fedora or cloche.
- Several seeded variants per kind, so a table of cards is not a row of clones.
- No human masks on lizards. The silhouette must be recognisable at small sizes.

## Do-nots

- No canvas gradients (`createLinearGradient` / `createRadialGradient`) on cards, board, seals, portraits or signs.
- No gilt or metallic shading.
- At most a light grain.
- No glows on cards.
- No bright or white large fills.
- Never copy or trace Schubert's artwork.

## Where it lives in code

- `client/style.css`: colour and font tokens (`--font-block` etc.) for the HUD.
- `client/scene/textures.ts`: `COLORS` and all canvas textures (cards, board, signs).
- `client/scene/seals.ts` (planned): party seals.
- `client/scene/portraits.ts` (planned): seeded lizard and human portraits.
- `tests/textures-palette.test.ts`: pins large-fill luminance.
