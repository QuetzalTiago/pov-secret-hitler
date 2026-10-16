# Spike: graphics and animation (todo #118, task FLT-3f2c3a1f)

## Question

How do we make the game look and move better: dramatic execution and game over, better lighting, events that animate instead of snapping, and less blocky characters? We must keep the procedural low-poly style with no GLTF asset pipeline (the user chose this), and we must not regress frame time.

## What I verified (read in the code)

- **No animation system.**
  - All motion is `Mover` (`client/scene/world.ts:48-79`), a `k = 1 - exp(-speed*dt)` lerp/slerp toward a target. So every motion has the same ease-out, with no arcs, anticipation, overshoot or stagger.
  - Timed beats are ad hoc `until` timestamps plus `setTimeout` (`client/game.ts` ~438, ~504).
- **Events that snap or only toast:**
  - `reshuffled`: pile heights snap via `setCount` (`client/scene/props.ts` ~143, called from `client/game.ts` ~945); the event itself is a sound and a toast (`game.ts` ~514).
  - `relayout` and `reconcilePool` snap (`client/game.ts` ~324, ~619). So does the veto token (`vetoMover`, `game.ts` ~1050).
  - The vote reveal flips every ballot at the same moment (`game.ts` ~1019).
  - The `enacted` stamp is a lerp, then a sound after a 650 ms `setTimeout` (`game.ts` ~489-507).
  - `drawn` teleports cards to the pile, then lerps them (`game.ts` ~450, ~587).
- **Execution** (`client/game.ts` ~555): recoil, camera shake, a muzzle PointLight and a CSS white flash (`client/ui.ts` ~276). The victim only slumps (`client/scene/characters.ts` ~363). There is no muzzle sprite, no smoke and no fall.
- **Game over** (`client/game.ts` ~576): a chime, then role cards rise. There is no camera move.
- **Lighting** (`client/scene/world.ts` ~125-165):
  - Uses ACESFilmic. The only shadow caster is the lamp SpotLight (1024^2 PCFSoft).
  - Patrons and walls do not `receiveShadow` (only the floor, counter, table top and felt do).
  - There is no environment map and no bloom. Glows are faked with sprites.
  - The light count is deliberately fixed (5 in `world.ts` plus the neon PointLight at ~302, and the hemisphere light) to avoid shader recompiles; `characters.ts` ~148 notes patrons use a sprite aura and emissive tint instead of real lights.
- **Characters** (`client/scene/characters.ts`):
  - Built from primitives: a 7-sided cylinder torso, an icosahedron head, and box hands and facial features.
  - They have no blinking, no talking mouth (the mouth is a static box, ~108), no gestures and no reactions.
- **Performance budget** (`docs/spikes/code-review-2026-10.md`):
  - Frames are bound by draw calls: 370-680 draw calls and 22-32 ms per frame at 5-10 players. The vote scene is the worst.
  - The GPU has spare fill capacity.
  - Measure with the `?perf` HUD (`client/perf.ts`) and `scripts/perf.ts`.

## Options

1. **Polish the procedural scene (recommended, chosen by the user).** Add a tween/timeline helper, lighting and post-processing, and authored motion per event.
2. **Real 3D assets.** Rigged GLTF characters with skeletal animation. Rejected for now: it needs licensing and a loader pipeline, and it costs more draw calls.
3. **Animation only.** Leave the lighting as it is. Rejected: lighting was one of the named pain points.

**Recommendation:**

- Build a small dependency-free tween/timeline module first. Every motion todo uses it.
- Then run two independent tracks:
  - **Look:** shadows, an environment map, then bloom.
  - **Motion:** cards, characters, execution, game over.
- Budget rule: post-processing costs fill (spare); new meshes cost draw calls (not spare). Merge or instance any new geometry. Add no new lights; reuse the existing ones.

## Risks and open questions

- **Bloom cost on low-end GPUs:** put it behind a quality flag that falls back to plain rendering.
- **The env map** triggers a one-time shader recompile. Check the program count stays constant afterwards.
- **Overlap with task LOCAL-bc050340:** todo #93 (shadows, pixel ratio) and todo #94 (instancing, merging) touch the same code. Coordinate.
- **Overlap with the parallel UX spike** on this task ("whose turn is it"): camera focus and prompt cues may overlap.
- **Time dilation during execution is client-only**, so server timers are unaffected. Keep it short so the UI never lags the server's state.

## Follow-up tracking

Task **FLT-0001 "Graphics and animation polish"** (branch `gfx-polish`). Todos, in dependency order:

| Todo | Work | Depends on |
|---|---|---|
| #120 | Tween/timeline helper `client/scene/tween.ts` + `tests/tween.test.ts` | - |
| #121 | Lighting pass: receiveShadow, PMREM RoomEnvironment, emissives | - |
| #122 | Post-processing: bloom, vignette, quality flag | #121 |
| #123 | Card motion: arced deal, slam, staggered reveal, enact stamp, reshuffle | #120 |
| #124 | Character life: blink, mouth flap, reactions, merged finger hands | #120 |
| #125 | Execution drama: muzzle sprite, smoke, punch-in, fall | #120, #124 |
| #126 | Game-over cinematic: dolly, team lighting, staggered reveal, instanced confetti | #120, #122, #123 |
| #127 | Perf and visual regression gate | #121-#126 |

## Perf gate (#127)

Baseline is the #91 table in `docs/spikes/code-review-2026-10.md`. #121 and #122 were measured in their commits (67f0f5b, a92a46d) with `npx tsx scripts/perf.ts --players 5,10 --gpu`. The "now" column is pending a human run of the same command on an idle machine (agents may not run perf.ts; see CLAUDE.md).

| players | scene | draw calls #91 | after #121 | after #122 (fx on) | now | programs #91 | after #122 | now | frame ms after #122 | now |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | lobby | 443 | 441 | 456 | pending | 8 | 19 | pending | 16.7 | pending |
| 5 | night | 371 | 368 | 382 | pending | 8 | 19 | pending | 16.7 | pending |
| 5 | vote | 422 | 416 | 431 | pending | 8 | 19 | pending | 16.7 | pending |
| 10 | lobby | 595 | 595 | 605 | pending | 8 | 19 | pending | 19.2 | pending |
| 10 | night | 568 | 571 | 577 | pending | 8 | 19 | pending | 23.8 | pending |
| 10 | vote | 682 | 675 | 685 | pending | 8 | 19 | pending | 22.7 | pending |

Static audit of #123-#126 (read in the code at bfa666a):

- **Lobby, night and vote: expected change of 0 draw calls.** Card motion only tweens existing meshes. Blinks, mouth and reactions only write scales to existing meshes. Merged hands replaced the box hands, so they don't add draw calls. Nothing added scales with player count, and no lights were added.
- **Execution:** one muzzle-flash sprite and six smoke-puff sprites are created hidden (`client/scene/world.ts`). They cost up to 7 transparent draws for about 1.5 s per shot, and nothing when idle.
- **Game over:** the confetti is one InstancedMesh (1 draw, no shadow), hidden until the ceremony starts. It adds one program variant (instanced + instanceColor + DoubleSide), which may hitch once when the confetti starts at 0.7 s. `Confetti.update` writes 140 matrices per frame until the game leaves gameOver. It could stop once every piece has landed; that is cheap and only happens at game over, so it was left as is.
- **Outside this issue:** the waiter's bulb SpotLight (#231, a558545) is a second SpotLight. It is fixed at construction, so the light count still never changes at runtime and causes no recompiles. The default patron is now the rigged character, so the procedural hands (about 1.7k triangles per flat hand) are only on the `?chars=old` fallback.
- **e2e screenshots:** the Playwright e2e suite was removed in #143, so there is nothing to refresh. Visual checks happen in the live game.
