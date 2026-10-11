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
