# Code review spike (todos #74, #85), 2026-10

## Question

The game was built fast across 5 phases without review. What bugs and performance problems does it have, which must be fixed now, and what follow-up work is needed?

## What I verified

- Baseline at commit b1ae9b0: `npm run typecheck` clean, `npm test` 88/88 passing.
- Method: full read of `server/` and `shared/` engine code; read-only review of `client/` and `client/scene/`; each finding below was checked against the code.

### Server: critical (fixed in this spike)

1. Crash risk: `server/room.ts` `botMove` (~line 373-382) throws `new Error('bot made illegal move')`. It runs inside timer callbacks (`onTimeout` ~359) and inside the un-awaited async `think` (~407-432). There is no `uncaughtException`/`unhandledRejection` handler anywhere, so one bad bot move kills the whole process and every room. `apply` (~314) also re-throws non-RuleError errors. Fixed in commit "Harden room timers and bot moves against exceptions"; regression test `tests/room-resilience.test.ts`.
2. Wrong host after a lobby seat is removed: `server/room.ts` `removeSeat` (~166-176) tests `host >= length` and `seats[host]?.bot` after the splice but before shifting the host index. E.g. host is seat 2 of 3, seat 0 leaves: host is reassigned to the old seat 1 instead of staying with the same player. Fixed in commit "Keep the right host when a lobby seat is removed"; regression test `tests/room-host.test.ts`.

### Server: minor (fixed)

- Game rooms whose humans all explicitly left stay until the 30-minute idle GC and count against maxRooms=50. Fixed in commit "Close game rooms once every human has left"; test `tests/room-empty.test.ts`.
- `botTalk` (`server/room.ts` ~439) sets the chat throttle even when the bot chose to stay silent. Fixed in commit "Bot chat throttle only on real lines; validate restored snapshots"; test `tests/bot-talk.test.ts`.
- `Room.restore` trusts the snapshot shape (seat count vs game players not validated). Fixed in the same commit: restore rejects an unknown stage, a seat/player count mismatch and an out-of-range host; tests in `tests/persistence.test.ts`.

### Client: state and UI bugs

- `client/main.ts` ~40-44 and the `left`/fatal-error handlers reset only the UI; `game.view`/`game.room` stay stale so `Game.update` (`client/game.ts` ~1105) keeps playing heartbeat/music mood/night lighting on the home screen.
- `client/game.ts`: `invShown`, `shot`, `pointAt`, `invFlight`, `pendingIndex` survive rematch/leave (lobby reset branch ~204-212 does not clear them); a leftover membership card keeps card mode on.
- `client/game.ts` `act()` (~585-595) does not refresh interactables, and `onRoom` (~185-186) resets `cardsDone`/`pickedPlayer` on every room message, so actions can be double-sent and the wrong card can animate to the discard pile.
- In-flight room messages after Leave re-show the room; chat logs (`client/ui.ts` ~262-277) and the leave-confirm dialog (~68-77) carry over to the next table.
- `client/ui.ts` ~126-129 copy-button label can stick; ~251 an old error timer can hide a newer error.
- `client/net.ts` ~22-28 try/catch swallows exceptions thrown by the message handler, not just JSON errors; up to 20 queued messages (including stale `act`s) are replayed after reconnect.
- `client/game.ts` ~265-290 duplicate envelope when a seat leaves and rejoins without a relayout. Fixed in #90.
- Checked and fine: no XSS (textContent/canvas only), seat indexing, chat log caps, no event replay on resume (server resume broadcasts no events).

### Client: rendering and performance

- `client/scene/characters.ts` ~146: one PointLight per patron, so up to 14 point lights; joins/leaves change the light count and recompile every material.
- `client/scene/world.ts` ~124: `preserveDrawingBuffer: true` always on (Playwright screenshots don't need it).
- GPU leaks: `world.ts` `setLayout` (~342) `tableGroup.clear()` without dispose; `Character.dispose` (`characters.ts` ~399) skips materials; envelope clones (`game.ts` ~285), game-over reveal cards (`game.ts` ~1046), chat-bubble SpriteMaterials (`characters.ts` ~246-251), `Board.setPowers` (`props.ts` ~114) materials never disposed; texture cache in `textures.ts` never evicts. Fixed in #90.
- Shadows: PCFSoftShadowMap at 1024^2 (`world.ts` ~128, ~145), ~35 shadow-casting meshes per patron; ~53 bottle draw calls (`world.ts` ~272-293); 26 large transparent smoke sprites (~326-334).
- Per-frame allocations: `client/interact.ts` ~72-89 `pick()` rebuilds a Map and array every frame; `computeTargets` (`game.ts` ~809-1052) allocates vectors/quaternions; new Raycaster per frame (`game.ts` ~100, ~980); `ui.setTimer` writes DOM every frame; `audio.ts` ~61-75 fills a fresh noise buffer per sfx call.

## Options

- A: fix everything in one pass.
- B (chosen): fix the two critical server bugs now (both can take the whole server down or break lobby control), and track the rest as an ordered follow-up task, measuring a perf baseline before the rendering work so optimisations are proven, not assumed.

## Perf baseline (todo #86)

Measured 2026-10-09 with `npm run perf` (`scripts/perf.ts`) after `npx vite build`. The script starts the server in-process (bot delay 300 ms), opens one human client at `/?perf&nolock=1` at 1280x720, adds bots up to N seats, and samples `window.__sh.perf()` (the `?perf` HUD's numbers) every 500 ms in three scenes: **lobby** (bots seated, before dealing), **night** (just after dealing), and **vote** (the human has acked the night and nominated if president, and an election vote is open). fps and frame ms are medians, worst ms is the max frame time, and counts are maxima over the samples. Draw calls and triangles come from `renderer.info.render`, so they include the shadow pass. Open any client with `?perf` to see the same HUD live.

Machine: Intel i5-10400F, NVIDIA RTX 4060 Ti, Windows 11, Playwright Chromium 153 headless with `--gpu` (ANGLE D3D11).

| players | scene | fps | frame ms | worst ms | draw calls | triangles | programs | geometries | textures |
|---|---|---|---|---|---|---|---|---|---|
| 5 | lobby | 46.0 | 22.0 | 116.6 | 441 | 6456 | 30 | 190 | 20 |
| 5 | night | 42.6 | 24.6 | 83.4 | 371 | 5772 | 31 | 193 | 24 |
| 5 | vote | 38.0 | 26.3 | 150.0 | 421 | 5862 | 31 | 202 | 26 |
| 10 | lobby | 43.1 | 23.5 | 83.4 | 592 | 8394 | 65 | 535 | 23 |
| 10 | night | 40.0 | 25.0 | 83.4 | 572 | 7616 | 65 | 543 | 28 |
| 10 | vote | 31.8 | 32.3 | 116.6 | 679 | 7838 | 65 | 557 | 30 |

Reading it:

- **fps is noisy and capped.** rAF is vsync-locked at 60 (`--disable-gpu-vsync` has no effect headless). An earlier 4 s run on the same machine read 60 fps everywhere except vote (58 at 5 players, 34 at 10). The run above had other sessions loading the CPU. Compare fps only between runs on an idle machine, and lean on the counts, which are stable to within a few draw calls between runs (and match in SwiftShader mode, `npm run perf` without `--gpu`).
- **Draw calls are high for the triangle count:** 370-680 calls for only 6-8k triangles. The scene is CPU/draw-call bound, not fill bound. That is the case for instancing/merging in #94 and for fewer shadow casters in #93.
- **Programs more than double from 5 to 10 players (30 to 65)**, even in the lobby. This fits the per-patron PointLight: each added light changes the light count and recompiles every lit material (#91).
- **Geometries scale with patrons (190 to 535)**, so patron meshes don't share geometry (#94). Geometries/textures also creep up from scene to scene within one game (for example 535 to 557), which is a baseline for the leak fixes in #90 (they should stay flat across rematches).
- **The vote scene is the slowest** in both runs, with the most draw calls and the worst frame spikes (83-150 ms hitches).

Re-measure after each of #90-#94 with `npm run perf -- --gpu --seconds 10` on an idle machine, and add a before/after row here.

### Leak check after #90

`npm run perf -- --leak 3` (new in #90; needs `npx vite build` first) plays 7-player games with seat churn (two bots leave and rejoin) and a rematch between rounds, and reads renderer.info at each game over. SwiftShader mode; counts are what matter.

| build | round 1 geometries | last round geometries | round 1 textures | last round textures | programs |
|---|---|---|---|---|---|
| before #90 (2 rounds) | 534 | 694 | 39 | 42 | 46 |
| after #90 (3 rounds) | 314 | 301 | 38 | 37 | 33 |

Geometries and textures now stay flat across rematches (they grew by 160 geometries per round before). Programs also dropped from 46 to 33 because disposed materials free their shader programs. The textures.ts cache is an LRU capped at 64 entries.

### After #91 (per-patron PointLight removed)

#91 replaced the per-patron PointLight with an additive glow sprite plus a red emissive tint, and this was re-measured with `npx tsx scripts/perf.ts --players 5,10 --seconds 4` in SwiftShader mode on the same machine (counts only, fps is not meaningful there).

| players | scene | draw calls before | after | programs before | after |
|---|---|---|---|---|---|
| 5 | lobby | 444 | 443 | 31 | 8 |
| 5 | night | 372 | 371 | 32 | 8 |
| 5 | vote | 424 | 422 | 32 | 8 |
| 10 | lobby | 598 | 595 | 65 | 8 |
| 10 | night | 582 | 568 | 65 | 8 |
| 10 | vote | 691 | 682 | 65 | 8 |

Programs are now a constant 8 for any player count and scene (no light-count recompiles on join/leave), and draw calls barely move, as expected, since the lights didn't add draw calls. Visual check: the night red glow on known teammates is still clearly visible (a bit more orange since nothing lights the patron's front anymore).

## Risks and open questions

- Rendering numbers above are measured (see Perf baseline); fps in headless Chromium is vsync-capped and sensitive to machine load, so draw calls/programs/geometries are the reliable comparison.
- The night-phase red glow is now a sprite plus emissive tint (#91); checked visually against before/after screenshots.
- Unverified: whether finished one-shot WebAudio nodes are garbage-collected in every browser.

## Follow-up tracking

Fleet task **LOCAL-bc050340** ("Code review follow-ups: client bugs & rendering perf") tracks the client work. The original follow-up task LOCAL-3071b063 no longer existed, so it was recreated. Its todos, in dependency order:

1. #86 Perf baseline `?perf` HUD; 5/10-player numbers recorded above (done).
2. #87 Reset client state on leave/left/fatal error; ignore room messages after leave.
3. #88 In-flight action guard (after #87).
4. #89 Small UI/net fixes (after #87).
5. #90 Dispose helper + GPU leak fixes + duplicate envelope (after #86).
6. #91 Replace per-patron PointLight (after #86) (done).
7. #92 Per-frame allocation cleanup (after #86).
8. #93 Renderer settings: preserveDrawingBuffer, shadows, pixel ratio on resize (after #86, #91).
9. #94 Draw-call reduction via instancing/shared geometry, re-measured against #86 (after #90, #93).
