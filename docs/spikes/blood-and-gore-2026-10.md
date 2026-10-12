# Spike: blood and gore from executions (todo #233)

## Question

The user asked for blood and gore from kills. Everything near the kill gets blood on it (the table, the cards, the board, the patrons next to the victim) and a pool of blood forms. How do we do this inside the draw-call budget, and in what order do we build it?

## What I verified

### Kill hook

- `client/game.ts` case `'executed'` (:741) has `e.by`, `e.target`, the gun's `matrixWorld` (muzzle and dir at :748-749), `this.slowmoClock` (:751), `world.flash(muzzle, dir)` (:750) and `chars.get(e.target)?.die()` (:744).
- Today the effects are a gunshot, a death voice, a muzzle flash, smoke puffs, camera shake, slow-mo and a death slump (`deathPose`, `client/scene/life.ts:89`, which leans back and tips the chair). There is no blood at all.
- The snapshot path (`client/game.ts:538`, `c.dead = !!p && !p.alive`) shows dead players with no event. A reconnect must therefore rebuild the final blood state from the seat alone, so the spray has to be seeded.

### Geometry

- The table is an ellipse top at `TABLE_Y = 0.78` (`client/scene/world.ts:27`), sized by `Layout` rx/rz (:66-71). The floor is y=0.
- `Layout.chair/front/head(seat)` (`world.ts:81`, :86, :93) give every anchor point. The head is the chair position at y=1.32.
- The `Board` (`client/scene/props.ts:145`) lies flat at the table centre.
- `Card` (`props.ts:14`) is a thin BoxGeometry moved by `Mover` (`world.ts:102`), so blood on a card has to follow it.

### Patrons

- `RiggedCharacter` (`client/scene/rigged.ts:269-272`) clones its geometry per patron and uses its own `MeshStandardMaterial({ vertexColors: true })`.
- Painting blood into that patron's colour attribute therefore costs nothing per frame, needs no shader, and can be unit-tested in node.
- The procedural fallback `Character` (`client/scene/characters.ts`) gets a no-op.

### Budget rules for this project

- Add no new lights, merge or instance new geometry, use flat inks with no gradients in canvas textures (`tests/textures-flat.test.ts`), and use only unit tests (no browser or perf runs).
- Precedents: `ActingRings` (one InstancedMesh, `props.ts:60`) and `CigaretteSmoke` (one pooled Points, `client/scene/smoke.ts:137`).

## Options

### Recommended

1. **Seeded spray (pure).** `client/scene/blood.ts` `spray(seed, victimHead, shooterHead, n)`.
   - A blowback cone toward the shooter and the table centre puts most of the blood on the table, cards and board.
   - An exit cone behind the victim covers the floor and chair, and a few droplets go upward.
   - Ballistic integration lands each droplet on the table ellipse or the floor.
   - Seed = (victim seat, kill index).
2. **Splats in one draw call.** An InstancedMesh of quads with a flat-ink splat atlas (a per-instance UV tile), depthWrite off and polygonOffset.
   - Each instance has an anchor Object3D plus a local matrix, recomputed each frame as anchor.matrixWorld x local, so blood on a card moves with the card.
   - A cap of about 256 recycles the oldest.
3. **Pool.** A second small InstancedMesh under the victim's chair that grows over about 10 s with ease-out, plus a slow drip from the victim's head.
4. **Patrons.** A pure `paintBlood` over bind-pose vertices facing the kill.
   - Heavy on the victim (head and chest), medium on the seats either side (the side toward the victim), light on the shooter's gun arm.
   - The original colours are kept so a new game restores them.
   - New Patron methods: `bloody(dirWorld, amount, seed)` and `headWorld(out)`.
5. **First person.** A CSS/canvas splat overlay that drips and fades over about 4 s when you sit next to the victim, and a heavy one when you are the victim. Your sleeves get a blood tint.
6. **Lifecycle and pref.** Blood clears on a new game, play again, or a forced setLayout. A Blood On/Off setting (localStorage) plus `?gore=0`, default On. Droplet count scales with the quality step.
7. **Optional.** A synthesized wet splat sfx.

Draw-call cost: +3 at most (splats, pool, droplet Points).

### Rejected

- **three.js DecalGeometry.** It doesn't follow skinned meshes or moving cards, and costs one draw call per decal.
- **A shader blood mask on the patron materials.** Finer detail, but it needs onBeforeCompile on every patron and can't be tested in node.
- **Drawing blood into the card and board canvas textures.** Those textures are shared between cards (policyFace), so every card would bleed.

## Risks and open questions

- Z-fighting of splats on moving or tilted cards: use polygonOffset plus a small lift along the anchor normal.
- Low-poly patrons (at most 6000 triangles) make the vertex-colour blood blotchy, not crisp. This fits the flat-ink look; check it live.
- The death slump leans back, so little blood would fall on the table in reality. The blowback cone is artistic licence.
- Content: gore defaults On, as the user asked, with a toggle for players who don't want it.
- A sibling session is reworking how the gun sits in the hand (`client/game.ts` and `client/scene/rigged.ts`). The wiring todos must rebase onto it.
- The human judges the look live. Agents can't run a browser here.

## Follow-up tracking

New Fleet task **FLT-0008 "Blood and gore from executions"** (branch `blood-gore`), in dependency order:

1. #235 Seeded spray and landing (pure, `tests/blood.test.ts`).
2. #236 Splat atlas and the BloodSplats instanced mesh with anchors. Needs #235.
3. #237 Wire into `game.ts` `'executed'`: board and card hit-test, pool, head drip, snapshot rebuild, clear on new game. Needs #236.
4. #238 `paintBlood` on the patron vertex colours plus `Patron.bloody`/`headWorld`. Needs #235, parallel to #236-#237.
5. #239 First-person screen spatter and sleeve tint. Needs #237, #238.
6. #240 Blood On/Off pref and the quality-scaled count. Needs #237.
7. #241 Optional wet splat sfx. Needs #237.
